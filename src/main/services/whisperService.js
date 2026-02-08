import { join, dirname } from 'path'
import fs from 'fs-extra'
import { exec } from 'child_process'
import { promisify } from 'util'
import { app } from 'electron'
import Store from 'electron-store'
import { convertWhisperJsonToAss } from '../utils/jsonToAss.js'

const execPromise = promisify(exec)
const store = new Store()

/**
 * Генерує SRT/ASS субтитри використовуючи Whisper
 */
export async function generateSrtWithWhisper(
  audioPath,
  srtPath,
  languageCode = 'auto',
  logFn = console.log
) {
  logFn(`🎙️ Whisper: Initializing (Lang: ${languageCode})...`)

  try {
    const isDev = !app.isPackaged
    const executableName = process.platform === 'win32' ? 'whisper.exe' : 'whisper'

    // 1. Шляхи до Whisper
    const defaultBinPath = isDev ? join(__dirname, '../../bin') : join(process.resourcesPath, 'bin')
    const customBinPath = store.get('whisperBinPath')

    let binPath = defaultBinPath
    if (customBinPath && typeof customBinPath === 'string') {
      const customExe = join(customBinPath, executableName)
      const customModel = join(customBinPath, 'ggml-base.bin')

      if (fs.existsSync(customExe) && fs.existsSync(customModel)) {
        binPath = customBinPath
        logFn(`ℹ️ Using Custom Whisper Path: ${binPath}`)
      } else {
        logFn(`⚠️ Custom path invalid. Reverting to default: ${defaultBinPath}`)
      }
    } else {
      logFn(`ℹ️ Using Default Whisper Path: ${binPath}`)
    }

    const whisperExe = join(binPath, executableName)
    const modelPath = join(binPath, 'ggml-base.bin')

    if (!fs.existsSync(whisperExe)) throw new Error(`Whisper executable missing at: ${whisperExe}`)
    if (!fs.existsSync(modelPath)) throw new Error(`Model missing at: ${modelPath}`)

    // 2. Підготовка аудіо (16kHz WAV)
    const workDir = dirname(audioPath)
    const tempWavName = 'temp_clean.wav'
    const tempWavPath = join(workDir, tempWavName)

    let ffmpegCmd = store.get('customFfmpegPath') || 'ffmpeg'
    ffmpegCmd = ffmpegCmd.replace(/"/g, '')

    logFn('🎙️ Converting audio to 16kHz WAV...')
    const convertCmd = `"${ffmpegCmd}" -y -i "${audioPath}" -ar 16000 -ac 1 -c:a pcm_s16le -map_metadata -1 -fflags +bitexact "${tempWavPath}"`
    await execPromise(convertCmd)

    // 3. Запуск Whisper (JSON + SRT)
    const outputBase = 'subtitles'
    // -oj = JSON, -osrt = SRT (якщо підтримується, інакше просто JSON конвертуємо)
    // Додаємо -l (мова) і --max-len (довжина рядка)
    const runCmd = `"${whisperExe}" -m "${modelPath}" -f "${tempWavName}" -oj -of "${outputBase}" -l ${languageCode} -ml 1`

    logFn('🎙️ Running Whisper AI (JSON mode)...')
    await execPromise(runCmd, { cwd: workDir })

    // Чистка
    fs.unlink(tempWavPath).catch(() => {})

    // 4. Конвертація в ASS (Караоке)
    const jsonFile = join(workDir, outputBase + '.json')
    const assFile = srtPath.replace('.srt', '.ass')

    // Перевіряємо, чи створився JSON
    if (fs.existsSync(jsonFile)) {
      logFn('🎨 Converting JSON to Karaoke ASS...')
      await convertWhisperJsonToAss(jsonFile, assFile)
      logFn('✅ Karaoke Subtitles generated.')
      return true
    } else {
      // Якщо JSON немає, шукаємо хоча б SRT (як фоллбек)
      const generatedSrt = join(workDir, outputBase + '.srt')
      if (fs.existsSync(generatedSrt)) {
        if (generatedSrt !== srtPath) await fs.move(generatedSrt, srtPath, { overwrite: true })
        logFn('⚠️ No JSON found, falling back to standard SRT.')
        return true
      }

      console.warn('Whisper finished but no JSON/SRT found.')
      return false
    }
  } catch (error) {
    console.error('Whisper Failed:', error)
    logFn(`⚠️ Whisper Error: ${error.message}`)
    return false
  }
}

/**
 * Додає ефект появи (fade) до субтитрів (для звичайних SRT)
 */
export async function addFadeEffectToSrt(srtPath) {
  try {
    if (!fs.existsSync(srtPath)) return

    let content = await fs.readFile(srtPath, 'utf8')

    const lines = content.split('\n')
    const newLines = lines.map((line) => {
      if (!line.trim() || /^\d+$/.test(line.trim()) || line.includes('-->')) {
        return line
      }
      if (line.includes('{\\fad')) return line
      return `{\\fad(400,0)}${line}`
    })

    await fs.writeFile(srtPath, newLines.join('\n'), 'utf8')
    console.log('✅ Animation tags added to SRT.')
  } catch (e) {
    console.error('Failed to add fade effects:', e)
  }
}
