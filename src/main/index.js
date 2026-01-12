import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import fs from 'fs-extra'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { exec } from 'child_process'
import { promisify } from 'util'
import Store from 'electron-store'
import log from 'electron-log'
import axios from 'axios'
import { autoUpdater } from 'electron-updater'

// --- CONSTANTS & CONFIG ---
const IMAGE_API_URL = 'https://voiceapi.csv666.ru/api/v1'
const GENAI_API_URL = 'https://genaipro.vn/api/v1'

const execPromise = promisify(exec)
const store = new Store()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Setup logging for AutoUpdater
autoUpdater.logger = log
autoUpdater.logger.transports.file.level = 'info'
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#121417',
    show: false, // Wait until ready-to-show
    frame: true,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon: join(__dirname, '../../build/icon.png') } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      nodeIntegration: false, // Security best practice
      contextIsolation: true // Security best practice
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    // Trigger update check slightly after startup
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify()
    }, 2000)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Load renderer (HMR in dev, file in prod)
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// --- APP LIFECYCLE ---

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.storymaker.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// --- AUTO UPDATER EVENTS ---

autoUpdater.on('checking-for-update', () => sendStatus('checking', 'Checking...'))
autoUpdater.on('update-available', () => sendStatus('downloading', 'Update found. Downloading...'))
autoUpdater.on('download-progress', (progress) => {
  const percent = Math.round(progress.percent)
  if (mainWindow) {
    mainWindow.webContents.send('log-update', `⬇️ Downloading update: ${percent}%`)
  }
})
autoUpdater.on('update-downloaded', () => sendStatus('ready', 'Update Ready!'))
autoUpdater.on('error', (err) => {
  log.error('Update error:', err)
  sendStatus('error', 'Update Error')
})

function sendStatus(state, msg) {
  if (mainWindow) {
    // We can reuse the 'log-update' channel or a specific status channel if implemented in UI
    mainWindow.webContents.send('log-update', `ℹ️ Updater: ${msg}`)
  }
}

// --- IPC HANDLERS: SETTINGS & FILES ---

ipcMain.handle('get-setting', (event, key) => store.get(key, null))
ipcMain.handle('save-setting', (event, key, value) => {
  store.set(key, value)
  return true
})

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('select-file', async (event, extensions = []) => {
  const filters =
    extensions.length > 0
      ? [{ name: 'Custom Files', extensions }]
      : [{ name: 'All Files', extensions: ['*'] }]

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('read-json', async (e, filePath) => {
  try {
    return await fs.readJson(filePath)
  } catch (error) {
    console.error('JSON Read Error:', error)
    return null
  }
})

ipcMain.handle('write-json', async (e, filePath, data) => {
  try {
    await fs.writeJson(filePath, data, { spaces: 2 })
    return true
  } catch (error) {
    console.error('JSON Write Error:', error)
    return false
  }
})

ipcMain.handle('get-version', () => app.getVersion())

// --- IPC HANDLERS: HISTORY ---

ipcMain.handle('get-history', () => store.get('generationHistory', []))

ipcMain.handle('clear-history', () => {
  store.set('generationHistory', [])
  return true
})

ipcMain.handle('open-folder', async (e, path) => {
  await shell.openPath(path)
})

// --- HELPER FUNCTIONS FOR GENERATION ---

const sendLog = (msg) => {
  if (mainWindow) mainWindow.webContents.send('log-update', msg)
}

async function generateElevenLabsImage(prompt, token, outputPath) {
  try {
    sendLog('🎨 11Labs: Creating image...')
    const cleanToken = token.trim()
    const response = await axios.post(
      `${IMAGE_API_URL}/image/create?as_file=true`,
      { prompt: prompt, aspect_ratio: '16:9' },
      {
        headers: {
          'x-api-key': cleanToken,
          'api-key': cleanToken,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      }
    )
    await fs.writeFile(outputPath, response.data)
    sendLog('📥 Image saved successfully!')
  } catch (error) {
    console.error('11Labs Error:', error.message)
    if (error.response && error.response.data) {
      const msg = Buffer.from(error.response.data).toString()
      sendLog(`⚠️ API Error: ${msg}`)
    }
    throw error
  }
}

async function downloadPollinationsImage(prompt, outputPath) {
  const seed = Math.floor(Math.random() * 100000)
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(
    prompt
  )}?width=1280&height=720&model=flux&seed=${seed}&nologo=true`

  const writer = fs.createWriteStream(outputPath)
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  })

  response.data.pipe(writer)
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve)
    writer.on('error', reject)
  })
}

async function generateGenAiAudio(text, voiceId, token, outputPath) {
  sendLog('🎙️ GenAI: Sending text...')

  const createRes = await axios.post(
    `${GENAI_API_URL}/labs/task`,
    {
      input: text,
      voice_id: voiceId,
      model_id: 'eleven_multilingual_v2',
      speed: 1.0
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  )

  const taskId = createRes.data.task_id
  if (!taskId) throw new Error('GenAI: Task ID not received')

  let audioUrl = null
  let attempts = 0

  // Polling loop
  while (attempts < 600) {
    await sleep(2000)
    const statusRes = await axios.get(`${GENAI_API_URL}/labs/task/${taskId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })

    const status = statusRes.data.status
    sendLog(`GenAI: Processing... (${status})`)

    if (status === 'completed') {
      audioUrl = statusRes.data.result
      break
    } else if (status === 'failed') {
      throw new Error('GenAI Task Failed')
    }
    attempts++
  }

  if (!audioUrl) throw new Error('GenAI: Timeout')

  const writer = fs.createWriteStream(outputPath)
  const response = await axios({
    url: audioUrl,
    method: 'GET',
    responseType: 'stream'
  })

  response.data.pipe(writer)
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve)
    writer.on('error', reject)
  })
}

async function createVideoFromProject(folderPath) {
  try {
    const audioPath = join(folderPath, 'audio.mp3')
    const imagesDir = join(folderPath, 'images')
    const videoOutputPath = join(folderPath, 'video.mp4')

    if (!fs.existsSync(audioPath)) throw new Error('Audio not found!')

    // Resolve FFmpeg path: Use custom path if set, otherwise assume system 'ffmpeg'
    let ffmpegCmd = store.get('customFfmpegPath') || 'ffmpeg'

    // Remove quotes if present to avoid errors in exec
    ffmpegCmd = ffmpegCmd.replace(/"/g, '')

    const slideDuration = 20
    const fadeDuration = 1

    // 1. Get Images
    const files = await fs.readdir(imagesDir)
    const images = files
      .filter((f) => f.endsWith('.jpg') || f.endsWith('.png'))
      .sort((a, b) => (parseInt(a.match(/\d+/)) || 0) - (parseInt(b.match(/\d+/)) || 0))

    if (images.length === 0) throw new Error('No images found!')

    sendLog(`🎬 Images detected: ${images.length}`)

    // 2. Build Inputs
    let inputs = ''
    images.forEach((img) => {
      // Use forward slashes for cross-platform ffmpeg compatibility
      const p = join(imagesDir, img).replace(/\\/g, '/')
      inputs += `-loop 1 -t ${slideDuration} -i "${p}" `
    })

    // 3. Build Filter Complex (XFade)
    let filter = ''
    let lastLabel = '[0:v]'
    let offset = slideDuration - fadeDuration

    for (let i = 1; i < images.length; i++) {
      const nextLabel = `[v${i}]`
      filter += `${lastLabel}[${i}:v]xfade=transition=fade:duration=${fadeDuration}:offset=${offset}${nextLabel};`
      lastLabel = nextLabel
      offset += slideDuration - fadeDuration
    }
    filter += `${lastLabel}format=yuv420p[v]`

    sendLog('🎬 Rendering video (this might take a while)...')

    const command = `"${ffmpegCmd}" -y ${inputs} -i "${audioPath}" -filter_complex "${filter}" -map "[v]" -map ${images.length}:a -c:v libx264 -c:a aac -shortest "${videoOutputPath}"`

    await execPromise(command)
    sendLog('🚀 Video Rendered Successfully: video.mp4')
  } catch (err) {
    sendLog(`⚠️ Video Render Error: ${err.message}`)
    console.error(err)
    // We don't throw here to allow the process to "finish" even if video fails
  }
}

// --- IPC HANDLERS: GENERATION FLOW ---

// STAGE 1: Text Generation
ipcMain.handle('generate-story-text', async (event, data) => {
  const {
    projectName,
    templateText,
    seoPrompt,
    title,
    language,
    outputFolder,
    modelName,
    targetLength
  } = data

  try {
    const apiKey = store.get('apiKey')
    if (!apiKey) throw new Error('Gemini API Key is missing in settings.')

    const genAI = new GoogleGenerativeAI(apiKey)
    const selectedModel = modelName || 'gemini-2.0-flash'
    const model = genAI.getGenerativeModel({ model: selectedModel })

    // Store model for Stage 2
    store.set('tempModelName', selectedModel)

    // Create Directory
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const folderName = `${projectName}_${timestamp}`
    const finalPath = join(outputFolder, folderName)
    await fs.ensureDir(finalPath)

    // Initialize Chat
    const chat = model.startChat({ history: [] })
    const TARGET_LENGTH = targetLength || 25000

    let currentMsg =
      templateText.replace('{TITLE}', title).replace('{LANGUAGE}', language) +
      `\n\n[SYSTEM: Target length: ${TARGET_LENGTH} chars. Write PART 1 (3000-4000 chars). NO MARKDOWN.]`

    let fullStoryText = ''
    let part = 1

    // Writing Loop
    while (true) {
      sendLog(`✍️ Writing Part ${part} (Total: ${fullStoryText.length} chars)...`)

      const result = await chat.sendMessage(currentMsg)
      const text = result.response.text()

      // Basic cleanup
      let cleanPart = text
        .replace(/```[a-z]*\n?|```/g, '')
        .replace(/(\*\*|__)(.*?)\1/g, '$2') // bold
        .replace(/(\*|_)(.*?)\1/g, '$2') // italic
        .trim()

      if (cleanPart) fullStoryText += cleanPart + '\n\n'

      const currentLen = fullStoryText.length

      // Check exit conditions
      if (currentLen >= TARGET_LENGTH * 0.95 || part >= 40 || text.includes('END')) {
        if (!text.includes('END') && currentLen < TARGET_LENGTH) {
          currentMsg = "Finish the story now. Write the ending and 'END'."
        } else {
          break
        }
      } else {
        part++
        const remaining = TARGET_LENGTH - currentLen
        currentMsg = `Continue (Part ${part}). Need ${remaining} more chars. Add details.`
      }

      await sleep(1500) // Avoid rate limits
    }

    const finalContent = fullStoryText.trim()
    await fs.writeFile(join(finalPath, 'story.txt'), finalContent)

    // SEO Description
    sendLog('📝 Generating SEO Description...')
    try {
      const finalSeoPrompt =
        seoPrompt && seoPrompt.trim().length > 0
          ? seoPrompt
          : 'Write a short YouTube description for this story. No markup.'

      const descResult = await chat.sendMessage(finalSeoPrompt)
      await fs.writeFile(join(finalPath, 'description.txt'), descResult.response.text().trim())
      sendLog('✅ SEO Description Saved')
    } catch (e) {
      console.warn('SEO Generation failed', e)
    }

    // Save History
    const history = store.get('generationHistory', [])
    history.unshift({
      title,
      projectName,
      path: finalPath,
      date: new Date().toLocaleString()
    })
    store.set('generationHistory', history.slice(0, 50))

    return { success: true, textToSpeak: finalContent, folderPath: finalPath }
  } catch (error) {
    console.error('Stage 1 Error:', error)
    return { success: false, error: error.message }
  }
})

// STAGE 2: Audio, Images, Video
ipcMain.handle('generate-audio-only', async (event, data) => {
  const { text, voice, ttsProvider, folderPath } = data

  try {
    await fs.writeFile(join(folderPath, 'final_script_for_audio.txt'), text)

    // 1. Scene Analysis
    sendLog('🤖 Analyzing scenes for images...')
    const scenesArray = []
    const TARGET_CHUNK_SIZE = 2000
    let currentIndex = 0

    while (currentIndex < text.length) {
      let nextSplitIndex = currentIndex + TARGET_CHUNK_SIZE
      if (nextSplitIndex >= text.length) {
        scenesArray.push({ id: scenesArray.length + 1, text: text.substring(currentIndex).trim() })
        break
      }
      let periodIndex = text.indexOf('.', nextSplitIndex)
      if (periodIndex === -1) {
        scenesArray.push({ id: scenesArray.length + 1, text: text.substring(currentIndex).trim() })
        break
      }
      scenesArray.push({
        id: scenesArray.length + 1,
        text: text.substring(currentIndex, periodIndex + 1).trim()
      })
      currentIndex = periodIndex + 1
    }

    // 2. Image Prompt Generation
    const apiKey = store.get('apiKey')
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: store.get('tempModelName') || 'gemini-2.0-flash'
    })

    const imageSystemPrompt = `Analyze this story array and generate an AI Image Prompt for EACH scene id. 
    STRICT: NO FACES, NO PEOPLE. Cinematic 8k.
    RETURN JSON ONLY: [{ "id": 1, "image_prompt": "..." }, ...] 
    Scenes: ${JSON.stringify(scenesArray)}`

    sendLog('🧠 Generating image prompts via Gemini...')
    const imgResult = await model.generateContent(imageSystemPrompt)

    let imagePrompts = []
    try {
      const rawJson = imgResult.response
        .text()
        .replace(/```json|```/g, '')
        .trim()
      imagePrompts = JSON.parse(rawJson)
    } catch (e) {
      console.error('JSON Parse Error', e)
      throw new Error('Failed to parse image prompts from AI')
    }

    await fs.writeJson(join(folderPath, 'scenes.json'), imagePrompts, { spaces: 2 })

    // 3. Generate Images
    const imgProvider = store.get('imageProvider') || 'free'
    const imgToken = store.get('elevenLabsImgKey')
    const imagesDir = join(folderPath, 'images')
    await fs.ensureDir(imagesDir)

    for (const p of imagePrompts) {
      sendLog(`🎨 Generating Image ${p.id}/${imagePrompts.length}...`)
      const imgPath = join(imagesDir, `scene_${p.id}.jpg`)
      try {
        if (imgProvider === 'eleven') {
          await generateElevenLabsImage(p.image_prompt, imgToken, imgPath)
        } else {
          await downloadPollinationsImage(p.image_prompt, imgPath)
        }
      } catch (e) {
        sendLog(`⚠️ Image ${p.id} failed, skipping.`)
      }
    }

    // 4. Generate Audio
    const audioPath = join(folderPath, 'audio.mp3')
    if (ttsProvider === 'genai') {
      const gToken = store.get('genAiKey')
      if (!gToken) throw new Error('GenAI Token missing in settings!')
      await generateGenAiAudio(text, voice, gToken, audioPath)
    } else {
      sendLog('🎙️ Generating Edge TTS Audio...')
      const tempPath = join(folderPath, 'temp_tts.txt')
      await fs.writeFile(tempPath, text)

      const edgePath = store.get('edgeTtsPath') || 'edge-tts'
      // Use quotes for paths to handle spaces
      await execPromise(
        `"${edgePath}" --file "${tempPath}" --write-media "${audioPath}" --voice ${voice}`
      )

      await fs.unlink(tempPath).catch(() => {})
    }

    // 5. Render Video
    await createVideoFromProject(folderPath)

    sendLog('✅ All processes completed!')
    shell.openPath(folderPath)
    return { success: true }
  } catch (error) {
    console.error('Stage 2 Error:', error)
    return { success: false, error: error.message }
  }
})
