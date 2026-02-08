import fs from 'fs-extra'
import { join } from 'path'
import axios from 'axios'
import { exec } from 'child_process'
import { promisify } from 'util'
import { app } from 'electron'
import Store from 'electron-store'
import { EdgeTTS } from 'node-edge-tts'

import { API_URLS } from '../config/constants.js'
import { sleep, splitTextSafe } from '../utils/helpers.js'

const execPromise = promisify(exec)
const store = new Store()

// --- PIPER TTS ---
export async function generatePiperAudio(
  text,
  modelName,
  folderPath,
  outputPath,
  logFn = console.log
) {
  logFn('🎙️ Piper TTS: Generating local audio...')

  try {
    const isDev = !app.isPackaged
    const executableName = process.platform === 'win32' ? 'piper.exe' : 'piper'

    const defaultBinPath = isDev
      ? join(__dirname, '../../bin/piper')
      : join(process.resourcesPath, 'bin/piper')

    const binPath = store.get('piperBinPath') || defaultBinPath
    const piperExe = join(binPath, executableName)
    const modelPath = join(binPath, modelName)

    if (!fs.existsSync(piperExe)) throw new Error(`Piper executable missing at: ${piperExe}`)
    if (!fs.existsSync(modelPath)) throw new Error(`Piper model missing at: ${modelPath}`)

    const cleanText = text.replace(/"/g, "'").replace(/\n/g, ' ')
    const tempTextFile = join(folderPath, 'temp_piper_text.txt')
    await fs.writeFile(tempTextFile, cleanText, 'utf8')

    const runCmd = `type "${tempTextFile}" | "${piperExe}" -m "${modelPath}" -f "${outputPath}"`
    await execPromise(runCmd)

    await fs.unlink(tempTextFile).catch(() => {})
    logFn('✅ Piper Audio generated.')
    return true
  } catch (error) {
    console.error('Piper Failed:', error)
    logFn(`⚠️ Piper Error: ${error.message}`)
    throw error
  }
}

// --- 11LABS AUDIO ---
export async function generate11LabsAudio(text, voiceId, token, outputPath, logFn = console.log) {
  logFn('🎙️ 11Labs Audio: Creating task...')
  const apiKey = token.trim()

  try {
    const createResponse = await axios.post(
      `${API_URLS.VOICE}/tasks`,
      { text: text, template_uuid: voiceId },
      { headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' } }
    )

    const taskId = createResponse.data.task_id
    if (!taskId) throw new Error('11Labs Audio: No Task ID returned')

    logFn(`🎙️ Task started (ID: ${taskId}). Waiting for result...`)

    let attempts = 0
    const maxAttempts = 450

    while (attempts < maxAttempts) {
      await sleep(2000)
      const statusRes = await axios.get(`${API_URLS.VOICE}/tasks/${taskId}/status`, {
        headers: { 'X-API-Key': apiKey }
      })

      const status = statusRes.data.status
      if (status === 'ending' || status === 'ending_processed') {
        logFn('🎙️ Status is ready. Downloading file...')
        const writer = fs.createWriteStream(outputPath)
        const response = await axios({
          method: 'GET',
          url: `${API_URLS.VOICE}/tasks/${taskId}/result`,
          headers: { 'X-API-Key': apiKey },
          responseType: 'stream'
        })
        response.data.pipe(writer)

        return new Promise((resolve, reject) => {
          writer.on('finish', () => {
            logFn('✅ Audio downloaded successfully.')
            resolve()
          })
          writer.on('error', reject)
        })
      }
      if (status === 'error') throw new Error('11Labs Audio Task Error')
      attempts++
    }
    throw new Error('11Labs Audio: Generation timed out')
  } catch (err) {
    console.error('11Labs Audio Error:', err.message)
    throw err
  }
}

// --- GENAI AUDIO ---
export async function generateGenAiAudio(text, voiceId, token, outputPath, logFn = console.log) {
  logFn('🎙️ GenAI: Sending text...')
  const createRes = await axios.post(
    `${API_URLS.GENAI}/labs/task`,
    { input: text, voice_id: voiceId, model_id: 'eleven_multilingual_v2', speed: 1.0 },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  )

  const taskId = createRes.data.task_id
  if (!taskId) throw new Error('GenAI: Task ID not received')

  let audioUrl = null
  let attempts = 0
  while (attempts < 600) {
    await sleep(2000)
    const statusRes = await axios.get(`${API_URLS.GENAI}/labs/task/${taskId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const status = statusRes.data.status
    if (status === 'completed') {
      audioUrl = statusRes.data.result
      break
    } else if (status === 'failed') throw new Error('GenAI Task Failed')
    attempts++
  }

  const writer = fs.createWriteStream(outputPath)
  const response = await axios({ url: audioUrl, method: 'GET', responseType: 'stream' })
  response.data.pipe(writer)
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve)
    writer.on('error', reject)
  })
}

// --- EDGE TTS (LONG TEXT) ---
export async function generateEdgeTtsAudio(
  text,
  voice,
  folderPath,
  outputPath,
  logFn = console.log
) {
  logFn('🎙️ Generating Edge TTS Audio (Long Text Mode)...')
  try {
    const tts = new EdgeTTS({
      voice: voice,
      lang: 'en-US',
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
      timeout: 60000
    })

    const chunks = splitTextSafe(text, 2500)
    const totalChunks = chunks.length
    logFn(`ℹ️ Text split into ${totalChunks} parts. Starting generation...`)

    // Очищаємо файл
    await fs.writeFile(outputPath, '')

    for (let i = 0; i < totalChunks; i++) {
      const chunk = chunks[i]
      const tempChunkPath = join(folderPath, `temp_part_${i}.mp3`)

      logFn(`🎙️ Processing part ${i + 1}/${totalChunks}...`)

      await tts.ttsPromise(chunk, tempChunkPath)
      const chunkData = await fs.readFile(tempChunkPath)
      await fs.appendFile(outputPath, chunkData)
      await fs.unlink(tempChunkPath).catch(() => {})
      await sleep(500)
    }

    logFn('✅ Full Edge TTS Audio generated successfully.')
    return true
  } catch (e) {
    console.error('EdgeTTS Error:', e)
    throw new Error(`Edge TTS failed: ${e.message}`)
  }
}
