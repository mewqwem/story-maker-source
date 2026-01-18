import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, dirname } from 'path'
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
    height: 750,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#121417',
    show: false,
    frame: true,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon: join(__dirname, '../../build/icon.png') } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify()
    }, 2000)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

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
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('select-file', async (event, extensions = []) => {
  const filters =
    extensions.length > 0
      ? [{ name: 'Custom Files', extensions }]
      : [{ name: 'All Files', extensions: ['*'] }]
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters })
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

// --- HELPER FUNCTIONS ---

const sendLog = (msg) => {
  if (mainWindow) mainWindow.webContents.send('log-update', msg)
}

// Отримання тривалості аудіо
async function getAudioDuration(audioPath, ffmpegPath) {
  try {
    let ffprobeCmd = 'ffprobe'
    if (ffmpegPath && ffmpegPath.toLowerCase().includes('ffmpeg')) {
      ffprobeCmd = ffmpegPath.replace(/ffmpeg(?:\.exe)?$/i, 'ffprobe.exe')
    }
    ffprobeCmd = ffprobeCmd.replace(/"/g, '')

    const cmd = `"${ffprobeCmd}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
    const { stdout } = await execPromise(cmd)
    const duration = parseFloat(stdout.trim())
    return isNaN(duration) ? 300 : duration
  } catch (e) {
    console.warn('FFprobe failed (using default 300s):', e.message)
    return 300
  }
}

async function generateElevenLabsImage(prompt, token, outputPath) {
  try {
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
  } catch (error) {
    console.error('11Labs Error:', error.message)
    throw error
  }
}

async function downloadPollinationsImage(prompt, outputPath) {
  const seed = Math.floor(Math.random() * 1000000)
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
    { input: text, voice_id: voiceId, model_id: 'eleven_multilingual_v2', speed: 1.0 },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  )

  const taskId = createRes.data.task_id
  if (!taskId) throw new Error('GenAI: Task ID not received')

  let audioUrl = null
  let attempts = 0
  while (attempts < 600) {
    await sleep(2000)
    const statusRes = await axios.get(`${GENAI_API_URL}/labs/task/${taskId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const status = statusRes.data.status
    if (status === 'completed') {
      audioUrl = statusRes.data.result
      break
    } else if (status === 'failed') throw new Error('GenAI Task Failed')
    attempts++
  }
  if (!audioUrl) throw new Error('GenAI: Timeout')

  const writer = fs.createWriteStream(outputPath)
  const response = await axios({ url: audioUrl, method: 'GET', responseType: 'stream' })
  response.data.pipe(writer)
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve)
    writer.on('error', reject)
  })
}

// --- LOGIC FOR VIDEO LOOPING (FIXED RELATIVE PATHS) ---
async function createVideoFromProject(folderPath) {
  try {
    const audioName = 'audio.mp3'
    const videoName = 'video.mp4'
    const audioPath = join(folderPath, audioName)
    const imagesDir = join(folderPath, 'images')

    if (!fs.existsSync(audioPath)) throw new Error('Audio not found!')

    let ffmpegCmd = store.get('customFfmpegPath') || 'ffmpeg'
    ffmpegCmd = ffmpegCmd.replace(/"/g, '')

    // 1. Get Audio Duration
    sendLog('🎬 Analyzing audio length...')
    const audioDuration = await getAudioDuration(audioPath, ffmpegCmd)
    sendLog(`ℹ️ Audio Duration: ${audioDuration}s`)

    // 2. Get Images
    if (!fs.existsSync(imagesDir)) throw new Error('Images folder missing!')
    const files = await fs.readdir(imagesDir)
    const uniqueImages = files
      .filter((f) => f.endsWith('.jpg') || f.endsWith('.png'))
      .sort((a, b) => (parseInt(a.match(/\d+/)) || 0) - (parseInt(b.match(/\d+/)) || 0))

    if (uniqueImages.length === 0) throw new Error('No images found!')

    sendLog(`🎬 Found ${uniqueImages.length} images for video.`)

    const execOptions = { cwd: folderPath }

    // --- CASE A: SINGLE IMAGE ---
    if (uniqueImages.length === 1) {
      const relImgPath = `images/${uniqueImages[0]}`
      const command = `"${ffmpegCmd}" -y -loop 1 -i "${relImgPath}" -i "${audioName}" -c:v libx264 -tune stillimage -c:a aac -b:a 192k -pix_fmt yuv420p -shortest "${videoName}"`

      sendLog('🎬 Rendering single-image video...')
      await execPromise(command, execOptions)

      // --- CASE B: MULTIPLE IMAGES (SLIDESHOW) ---
    } else {
      const slideDuration = 20
      const fadeDuration = 1
      const effectiveSlideTime = slideDuration - fadeDuration
      const totalSlidesNeeded = Math.ceil(audioDuration / effectiveSlideTime) + 1

      sendLog(`🎬 Rendering slideshow: need ${totalSlidesNeeded} slides loop...`)

      let inputFilesList = []
      for (let i = 0; i < totalSlidesNeeded; i++) {
        const imgIndex = i % uniqueImages.length
        inputFilesList.push(`images/${uniqueImages[imgIndex]}`)
      }

      let inputs = ''
      inputFilesList.forEach((p) => {
        inputs += `-loop 1 -t ${slideDuration} -i "${p}" `
      })

      let filter = ''
      let lastLabel = '[0:v]'
      let offset = slideDuration - fadeDuration

      for (let i = 1; i < inputFilesList.length; i++) {
        const nextLabel = `[${i}:v]`
        const outLabel = `[v${i}]`
        filter += `${lastLabel}${nextLabel}xfade=transition=fade:duration=${fadeDuration}:offset=${offset}${outLabel};`
        lastLabel = outLabel
        offset += slideDuration - fadeDuration
      }

      // --- ВИПРАВЛЕННЯ ТУТ ---
      // Раніше ми обрізали ';' і ставили комою, що ламало потік.
      // Тепер ми явно беремо lastLabel і передаємо його у format.
      // Результат буде виглядати як: ...[v15];[v15]format=yuv420p[v]

      filter += `${lastLabel}format=yuv420p[v]`

      const command = `"${ffmpegCmd}" -y ${inputs} -i "${audioName}" -filter_complex "${filter}" -map "[v]" -map ${inputFilesList.length}:a -c:v libx264 -c:a aac -shortest "${videoName}"`

      await execPromise(command, execOptions)
    }

    sendLog('🚀 Video Rendered Successfully: video.mp4')
  } catch (err) {
    sendLog(`⚠️ Video Render Error: ${err.message}`)
    console.error(err)
    if (err.stdout) console.log(err.stdout)
    if (err.stderr) console.error(err.stderr)
  }
}

// --- IPC HANDLERS: GENERATION FLOW ---

ipcMain.handle('generate-story-text', async (event, data) => {
  // storyPrompt - це текст шаблону, який прийшов з library.json (через фронтенд)
  const {
    projectName,
    storyPrompt,
    seoPrompt,
    title,
    language,
    outputFolder,
    modelName,
    targetLength
  } = data

  try {
    const apiKey = store.get('apiKey')
    if (!apiKey) throw new Error('Gemini API Key is missing.')

    // 1. ПЕРЕВІРКА: Чи прийшов шаблон?
    if (!storyPrompt || typeof storyPrompt !== 'string') {
      throw new Error('Template (storyPrompt) is missing or empty! Check your frontend logic.')
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    const selectedModel = modelName || 'gemini-2.0-flash'
    const model = genAI.getGenerativeModel({ model: selectedModel })

    // 2. СТВОРЕННЯ ПАПКИ
    const safeProjectName = projectName
      .replace(/[а-яА-ЯіІїЇєЄґҐ]/g, 'ua')
      .replace(/[^a-zA-Z0-9]/g, '_')

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const folderName = `${safeProjectName}_${timestamp}`
    const finalPath = join(outputFolder, folderName)

    await fs.ensureDir(finalPath)

    sendLog('✍️ Starting Story Generation...')

    // 3. ПІДГОТОВКА ПРОМПТУ (Підстановка змінних у шаблон)
    // Шаблон у library.json може мати вигляд: "Write a story about {title} in {language}..."
    // Ми замінюємо ці слова на реальні значення.
    let finalInitialPrompt = storyPrompt
      .replace(/{title}/gi, title)
      .replace(/{language}/gi, language)
      .replace(/{length}/gi, targetLength || 'medium')
      .replace(/{projectName}/gi, projectName)

    // Додаємо технічні правила в кінець, щоб цикл працював, навіть якщо їх немає в шаблоні
    const systemRules = `
      \n\nSYSTEM RULES (MUST FOLLOW):
      1. Write the story in parts. Do NOT write the whole story at once.
      2. At the end of a part, write exactly "CONTINUE" if not finished.
      3. If the story is completely finished, write exactly "END".
      4. Language: ${language}.
      5. No markdown headers.
    `

    // Перше повідомлення: Шаблон + Правила
    let nextMessage = finalInitialPrompt + systemRules

    const chat = model.startChat({ history: [] })
    let fullStoryText = ''
    let isFinished = false
    let iteration = 0

    // 4. ЦИКЛ ГЕНЕРАЦІЇ
    while (!isFinished && iteration < 30) {
      iteration++
      sendLog(`✍️ Writing part ${iteration}...`)

      try {
        // Відправляємо повідомлення (перший раз - промпт, далі - 'continue')
        const result = await chat.sendMessage(nextMessage)
        const rawText = result.response.text()

        // Чистимо текст від службових слів
        let cleanChunk = rawText
          .replace(/CONTINUE/gi, '')
          .replace('Type ‘CONTINUE’ to receive the next part.', '')
          .replace(/END/gi, '')
          .replace(/\*\*/g, '')
          .replace(/##/g, '')
          .trim()

        if (cleanChunk) {
          fullStoryText += cleanChunk + '\n\n'
        }

        // Перевіряємо тригери
        if (rawText.includes('END')) {
          isFinished = true
          sendLog('✅ Story finished by AI.')
        } else {
          // Якщо AI забув написати CONTINUE, але й END не написав — продовжуємо
          nextMessage = 'continue'
          await sleep(2000)
        }
      } catch (err) {
        console.error(`Generation Error at part ${iteration}:`, err)
        // Якщо помилка (наприклад, перевантаження), пробуємо зберегти те, що є і вийти
        break
      }
    }

    // 5. ЗБЕРЕЖЕННЯ
    const finalContent = fullStoryText.trim()
    if (!finalContent) throw new Error('AI produced empty text.')

    await fs.writeFile(join(finalPath, 'story.txt'), finalContent)

    // 6. SEO (Використовуємо твій шаблон для SEO або дефолтний)
    sendLog('📝 Generating SEO...')
    try {
      const seoTemplate =
        seoPrompt ||
        `Based on the story above, write YouTube Title, Description, Hashtags. Lang: ${language}.`

      // Тут теж можна зробити підстановку, якщо в SEO шаблоні є змінні
      const finalSeoPrompt = seoTemplate.replace(/{title}/gi, title)

      const descRes = await chat.sendMessage(finalSeoPrompt)
      await fs.writeFile(join(finalPath, 'description.txt'), descRes.response.text().trim())
    } catch (e) {
      console.warn('SEO gen failed', e)
    }

    // 7. ІСТОРІЯ В ПРОГРАМІ
    const history = store.get('generationHistory', [])
    history.unshift({
      title: projectName,
      projectName,
      path: finalPath,
      date: new Date().toLocaleString()
    })
    store.set('generationHistory', history.slice(0, 50))

    // Повертаємо успіх, щоб фронтенд міг запустити наступний етап (Картинки/Аудіо)
    return { success: true, textToSpeak: finalContent, folderPath: finalPath }
  } catch (error) {
    console.error('Story Gen Error:', error)
    return { success: false, error: error.message }
  }
})

// STAGE 2: Audio, Images, Video
ipcMain.handle('generate-audio-only', async (event, data) => {
  const { text, voice, ttsProvider, folderPath, imagePrompt, imageCount } = data

  try {
    await fs.writeFile(join(folderPath, 'final_script_for_audio.txt'), text)

    // --- КРОК 1: ГЕНЕРАЦІЯ КАРТИНОК ---
    const imagesDir = join(folderPath, 'images')
    await fs.ensureDir(imagesDir)

    let countToGen = parseInt(imageCount)
    if (isNaN(countToGen) || countToGen < 1) countToGen = 1

    const finalImagePrompt = imagePrompt || 'Atmospheric cinematic background, 8k, detailed'

    sendLog(
      `🎨 Starting Image Generation: Count=${countToGen}, Prompt="${finalImagePrompt.substring(0, 20)}..."`
    )

    const imgProvider = store.get('imageProvider') || 'free'
    const imgToken = store.get('elevenLabsImgKey')

    for (let i = 1; i <= countToGen; i++) {
      const imgName = `scene_${i}.jpg`
      const imgPath = join(imagesDir, imgName)

      sendLog(`🎨 Generating Image ${i}/${countToGen}...`)

      try {
        if (imgProvider === 'eleven') {
          await generateElevenLabsImage(finalImagePrompt, imgToken, imgPath)
        } else {
          await downloadPollinationsImage(finalImagePrompt, imgPath)
        }
        sendLog(`✅ Image ${i} saved.`)
      } catch (e) {
        console.error(`Failed to generate image ${i}:`, e)
        sendLog(`⚠️ Image ${i} failed. Skipping.`)
      }
      await sleep(1000)
    }

    const files = await fs.readdir(imagesDir)
    if (files.filter((f) => f.endsWith('.jpg')).length === 0) {
      sendLog('⚠️ WARNING: No images generated! Creating a dummy image...')
    }

    // --- КРОК 2: ГЕНЕРАЦІЯ АУДІО ---
    const audioPath = join(folderPath, 'audio.mp3')

    if (ttsProvider === 'genai') {
      const gToken = store.get('genAiKey')
      if (!gToken) throw new Error('GenAI Token missing!')
      await generateGenAiAudio(text, voice, gToken, audioPath)
    } else {
      sendLog('🎙️ Generating Edge TTS Audio...')
      const cleanText = text.replace(/["`]/g, '').replace(/\n/g, ' ')
      const tempPath = join(folderPath, 'temp_tts.txt')
      await fs.writeFile(tempPath, cleanText, 'utf8')

      const edgePath = store.get('edgeTtsPath') || 'edge-tts'
      // ВИПРАВЛЕНО: Прибрали --encoding utf-8
      const command = `"${edgePath}" --file "${tempPath}" --write-media "${audioPath}" --voice ${voice}`

      await execPromise(command)
    }

    // --- КРОК 3: ВІДЕО ---
    await createVideoFromProject(folderPath)

    sendLog('✅ All processes completed!')
    shell.openPath(folderPath)
    return { success: true }
  } catch (error) {
    console.error('Stage 2 Error:', error)
    return { success: false, error: error.message }
  }
})
