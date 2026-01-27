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
import { EdgeTTS } from 'node-edge-tts'
// --- CONSTANTS & CONFIG ---
const IMAGE_API_URL = 'https://voiceapi.csv666.ru/api/v1'
const GENAI_API_URL = 'https://genaipro.vn/api/v1'
const VOICE_API_URL = 'https://voiceapi.csv666.ru'

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
function formatTimeSRT(seconds) {
  const date = new Date(0)
  date.setMilliseconds(seconds * 1000)
  const hh = date.getUTCHours().toString().padStart(2, '0')
  const mm = date.getUTCMinutes().toString().padStart(2, '0')
  const ss = date.getUTCSeconds().toString().padStart(2, '0')
  const ms = date.getUTCMilliseconds().toString().padStart(3, '0')
  return `${hh}:${mm}:${ss},${ms}`
}
function splitTextSafe(text, maxLength = 2500) {
  // Розбиваємо по реченнях (шукаємо крапку, знак оклику/питання або новий рядок)
  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text]
  const chunks = []
  let currentChunk = ''

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxLength) {
      chunks.push(currentChunk)
      currentChunk = sentence
    } else {
      currentChunk += sentence
    }
  }
  if (currentChunk) chunks.push(currentChunk)

  return chunks
}
// Функція генерації SRT файлу через Whisper
async function generateSrtWithWhisper(audioPath, srtPath, languageCode = 'auto') {
  sendLog(`🎙️ Whisper: Initializing (Lang: ${languageCode})...`)

  try {
    const isDev = !app.isPackaged

    // Визначаємо назву файлу залежно від ОС
    // Якщо Windows -> whisper.exe, якщо Mac/Linux -> whisper
    const executableName = process.platform === 'win32' ? 'whisper.exe' : 'whisper'

    // 1. Стандартний шлях
    const defaultBinPath = isDev ? join(__dirname, '../../bin') : join(process.resourcesPath, 'bin')

    // 2. Кастомний шлях (з налаштувань)
    const customBinPath = store.get('whisperBinPath')

    let binPath = defaultBinPath

    // 3. Перевірка кастомного шляху
    if (customBinPath && typeof customBinPath === 'string') {
      const customExe = join(customBinPath, executableName)
      const customModel = join(customBinPath, 'ggml-base.bin')

      if (fs.existsSync(customExe) && fs.existsSync(customModel)) {
        binPath = customBinPath
        sendLog(`ℹ️ Using Custom Whisper Path: ${binPath}`)
      } else {
        sendLog(`⚠️ Custom path invalid. Reverting to default: ${defaultBinPath}`)
      }
    } else {
      sendLog(`ℹ️ Using Default Whisper Path: ${binPath}`)
    }

    const whisperExe = join(binPath, executableName)
    const modelPath = join(binPath, 'ggml-base.bin')

    // Фінальна перевірка
    if (!fs.existsSync(whisperExe)) throw new Error(`Whisper executable missing at: ${whisperExe}`)
    if (!fs.existsSync(modelPath)) throw new Error(`Model missing at: ${modelPath}`)

    // Підготовка аудіо (Конвертація в 16kHz WAV без метаданих)
    const workDir = dirname(audioPath)
    const tempWavName = 'temp_clean.wav'
    const tempWavPath = join(workDir, tempWavName)

    let ffmpegCmd = store.get('customFfmpegPath') || 'ffmpeg'
    ffmpegCmd = ffmpegCmd.replace(/"/g, '')

    sendLog('🎙️ Converting audio to 16kHz WAV...')
    const convertCmd = `"${ffmpegCmd}" -y -i "${audioPath}" -ar 16000 -ac 1 -c:a pcm_s16le -map_metadata -1 -fflags +bitexact "${tempWavPath}"`
    await execPromise(convertCmd)

    // Запуск Whisper
    const outputBase = 'subtitles'

    // Тут ми використовуємо знайдені шляхи
    const runCmd = `"${whisperExe}" -m "${modelPath}" -f "${tempWavName}" -osrt -of "${outputBase}" -l ${languageCode} --max-len 40`

    sendLog('🎙️ Running Whisper AI (Max-len 60)...')
    await execPromise(runCmd, { cwd: workDir })

    // Чистка і перевірка
    fs.unlink(tempWavPath).catch(() => {})
    const generatedFile = join(workDir, outputBase + '.srt')

    if (fs.existsSync(generatedFile)) {
      if (generatedFile !== srtPath) await fs.move(generatedFile, srtPath, { overwrite: true })
      sendLog('✅ SRT generated successfully.')
      return true
    } else {
      // Check fallback name (іноді віспер називає файл як аудіофайл + .srt)
      const weirdFile = join(workDir, tempWavName + '.srt')
      if (fs.existsSync(weirdFile)) {
        await fs.move(weirdFile, srtPath, { overwrite: true })
        return true
      }
      console.warn('Whisper finished but no SRT file found (maybe silence).')
      return false // Не кидаємо помилку, просто йдемо далі без субтитрів
    }
  } catch (error) {
    console.error('Whisper Failed:', error)
    sendLog(`⚠️ Whisper Error: ${error.message}`)
    return false
  }
}

// --- ОНОВЛЕНИЙ ОБРОБНИК GENERATE-AUDIO-ONLY ---

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
async function generate11LabsAudio(text, voiceId, token, outputPath) {
  sendLog('🎙️ 11Labs Audio: Creating task...')
  const apiKey = token.trim()

  try {
    const createResponse = await axios.post(
      `${VOICE_API_URL}/tasks`,
      {
        text: text,
        template_uuid: voiceId
      },
      {
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json'
        }
      }
    )

    const taskId = createResponse.data.task_id
    if (!taskId) throw new Error('11Labs Audio: No Task ID returned')

    sendLog(`🎙️ Task started (ID: ${taskId}). Waiting for result...`)

    // 2. Очікування та скачування
    let attempts = 0
    const maxAttempts = 450 // Чекаємо до 15 хв

    while (attempts < maxAttempts) {
      await sleep(2000)

      const statusRes = await axios.get(`${VOICE_API_URL}/tasks/${taskId}/status`, {
        headers: { 'X-API-Key': apiKey }
      })

      const status = statusRes.data.status
      console.log(`[11Labs] Status: ${status} (Attempt ${attempts})`)

      // Якщо статус ending або ending_processed — качаємо
      if (status === 'ending' || status === 'ending_processed') {
        sendLog('🎙️ Status is ready. Downloading file...')

        const writer = fs.createWriteStream(outputPath)

        const response = await axios({
          method: 'GET',
          url: `${VOICE_API_URL}/tasks/${taskId}/result`,
          headers: { 'X-API-Key': apiKey },
          responseType: 'stream'
        })

        // Перевірка: якщо сервер раптом повернув JSON з помилкою замість файлу
        if (
          response.headers['content-type'] &&
          response.headers['content-type'].includes('application/json')
        ) {
          throw new Error(
            'Server returned JSON instead of Audio file (Check Voice ID/Template UUID)'
          )
        }

        response.data.pipe(writer)

        return new Promise((resolve, reject) => {
          writer.on('finish', () => {
            sendLog('✅ Audio downloaded successfully.')
            resolve()
          })
          writer.on('error', (err) => {
            console.error('File Write Error:', err)
            reject(err)
          })
        })
      }

      if (status === 'error') {
        throw new Error('11Labs Audio Task returned Error status from server')
      }

      attempts++
    }

    throw new Error('11Labs Audio: Generation timed out')
  } catch (err) {
    console.error('11Labs Audio API Error:', err.response ? err.response.data : err.message)
    throw new Error(`11Labs Audio Failed: ${err.message}`)
  }
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
async function addFadeEffectToSrt(srtPath) {
  try {
    // 🔥 ВАЖЛИВО: Перевіряємо, чи існує файл перед тим, як його читати
    // Якщо файлу немає (бо ти зняв галочку), ми просто виходимо з функції
    if (!fs.existsSync(srtPath)) {
      return
    }

    let content = await fs.readFile(srtPath, 'utf8')

    // Регулярний вираз шукає текст субтитрів і додає тег {\fad(400,0)}
    // Це означає: плавна поява за 400мс (0.4с)
    const lines = content.split('\n')
    const newLines = lines.map((line) => {
      // Пропускаємо порожні рядки, номери (цифри) і таймкоди (-->)
      if (!line.trim() || /^\d+$/.test(line.trim()) || line.includes('-->')) {
        return line
      }

      // Перевірка, щоб не додавати тег двічі
      if (line.includes('{\\fad')) return line

      // Додаємо тег перед текстом
      return `{\\fad(400,0)}${line}`
    })

    await fs.writeFile(srtPath, newLines.join('\n'), 'utf8')
    console.log('✅ Animation tags added to SRT.')
  } catch (e) {
    // Тепер помилка ENOENT не повинна з'являтися, але лог залишаємо
    console.error('Failed to add fade effects:', e)
  }
}

// --- ОНОВЛЕНА ФУНКЦІЯ createVideoFromProject ---
async function createVideoFromProject(folderPath, visualMode = 'images') {
  try {
    const audioName = 'audio.mp3'
    const videoName = 'video.mp4'
    const srtName = 'subtitles.srt'

    const audioPath = join(folderPath, audioName)
    const srtPath = join(folderPath, srtName)

    let ffmpegCmd = store.get('customFfmpegPath') || 'ffmpeg'
    ffmpegCmd = ffmpegCmd.replace(/"/g, '')

    const subSettings = store.get('subtitleSettings') || {
      font: 'Merriweather Light',
      size: 24,
      primary: '#FFFFFF',
      outline: '#000000',
      borderStyle: '1',
      alignment: '2',
      italic: true,
      outlineWidth: 0
    }
    const fontName = subSettings.font
    const fontSize = subSettings.size
    const outlineWidth = subSettings.outlineWidth || 0
    const assPrimary = hexToAssColor(subSettings.primary)
    const assOutline = hexToAssColor(subSettings.outline)
    const borderStyle = subSettings.borderStyle
    const alignment = subSettings.alignment
    const italic = subSettings.italic ? '1' : '0'

    const styleASS = `Fontname=${fontName},Italic=${italic},Fontsize=${fontSize},PrimaryColour=${assPrimary},OutlineColour=${assOutline},BorderStyle=${borderStyle},Outline=${outlineWidth},Shadow=0.5,MarginV=25,Alignment=${alignment}`

    // 1. Get Audio Duration
    sendLog('🎬 Analyzing audio length...')
    const audioDuration = await getAudioDuration(audioPath, ffmpegCmd)
    sendLog(`ℹ️ Audio Duration: ${audioDuration}s`)

    // Підготовка фільтра субтитрів (UTF-8)
    let subtitlesFilter = ''
    if (fs.existsSync(srtPath)) {
      // Використовуємо :charenc=UTF-8 щоб уникнути крякозябрів
      // Відносний шлях srtName працює краще з execOptions.cwd
      subtitlesFilter = `,subtitles='${srtName}':charenc=UTF-8:force_style='${styleASS}'`
    }

    const execOptions = { cwd: folderPath }

    // ============================
    // РЕЖИМ 1: ВІДЕО-ЛУП
    // ============================
    if (visualMode === 'video') {
      const bgVideo = 'source_bg.mp4'
      if (!fs.existsSync(join(folderPath, bgVideo))) throw new Error('Source video missing!')

      sendLog('🎬 Rendering looped video with subtitles...')

      // scale=1920:1080...crop... -> Робимо 16:9 і заповнюємо екран
      const filter = `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1${subtitlesFilter}`

      // -stream_loop -1: Нескінченний повтор відео
      // -shortest: Обрізати по найкоротшому (по аудіо)
      const command = `"${ffmpegCmd}" -y -stream_loop -1 -i "${bgVideo}" -i "${audioName}" -vf "${filter}" -map 0:v -map 1:a -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -shortest "${videoName}"`
      await execPromise(command, execOptions)
    }
    // ============================
    // РЕЖИМ 2: КАРТИНКИ (СЛАЙД-ШОУ)
    // ============================
    else {
      const imagesDir = join(folderPath, 'images')
      if (!fs.existsSync(imagesDir)) throw new Error('Images folder missing!')

      const files = await fs.readdir(imagesDir)
      const uniqueImages = files
        .filter((f) => f.endsWith('.jpg') || f.endsWith('.png'))
        .sort((a, b) => (parseInt(a.match(/\d+/)) || 0) - (parseInt(b.match(/\d+/)) || 0))

      if (uniqueImages.length === 0) throw new Error('No images found!')

      sendLog(`🎬 Found ${uniqueImages.length} images for video.`)

      // ❌ ВИДАЛЕНО: const style = 'Fontname=...' (бо ми вже маємо styleASS зверху)

      if (uniqueImages.length === 1) {
        // Одне фото
        const relImgPath = `images/${uniqueImages[0]}`

        let filter = 'format=yuv420p'
        if (fs.existsSync(srtPath)) {
          // ✅ ВИПРАВЛЕНО: замість style ставимо styleASS
          filter += `,subtitles='${srtName}':charenc=UTF-8:force_style='${styleASS}'`
        }

        const command = `"${ffmpegCmd}" -y -loop 1 -i "${relImgPath}" -i "${audioName}" -vf "${filter}" -c:v libx264 -preset medium -crf 18 -tune stillimage -c:a aac -b:a 192k -shortest "${videoName}"`
        await execPromise(command, execOptions)
      } else {
        // Слайд-шоу
        const slideDuration = 20
        const fadeDuration = 1
        const effectiveSlideTime = slideDuration - fadeDuration
        const totalSlidesNeeded = Math.ceil(audioDuration / effectiveSlideTime) + 1

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

        if (fs.existsSync(srtPath)) {
          // ✅ ВИПРАВЛЕНО: замість style ставимо styleASS
          filter += `${lastLabel}format=yuv420p[v_pre];[v_pre]subtitles='${srtName}':charenc=UTF-8:force_style='${styleASS}'[v]`
        } else {
          filter += `${lastLabel}format=yuv420p[v]`
        }

        const command = `"${ffmpegCmd}" -y ${inputs} -i "${audioName}" -filter_complex "${filter}" -map "[v]" -map ${inputFilesList.length}:a -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -shortest "${videoName}"`
        await execPromise(command, execOptions)
      }
    }

    sendLog('🚀 Video Rendered Successfully: video.mp4')
  } catch (err) {
    sendLog(`⚠️ Video Render Error: ${err.message}`)
    console.error(err)
  }
}

// --- IPC HANDLERS: GENERATION FLOW ---

ipcMain.handle('generate-story-text', async (event, data) => {
  const {
    projectName,
    storyPrompt,
    seoPrompt,
    title,
    language,
    outputFolder,
    modelName,
    targetLength,
    onePartStory
  } = data

  try {
    const apiKey = store.get('apiKey')
    if (!apiKey) throw new Error('Gemini API Key is missing.')

    // 1. ПЕРЕВІРКА
    if (!storyPrompt || typeof storyPrompt !== 'string') {
      throw new Error('Template (storyPrompt) is missing! Check frontend.')
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    const selectedModel = modelName || 'gemini-2.0-flash'
    const model = genAI.getGenerativeModel({ model: selectedModel })

    // 2. ПАПКИ
    const safeProjectName = projectName
      .replace(/[а-яА-ЯіІїЇєЄґҐ]/g, 'ua')
      .replace(/[^a-zA-Z0-9]/g, '_')

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const folderName = `${safeProjectName}_${timestamp}`
    const finalPath = join(outputFolder, folderName)

    await fs.ensureDir(finalPath)

    sendLog('✍️ Starting Story Generation...')
    console.log('Raw targetLength:', targetLength)
    // 3. ПІДГОТОВКА ПРОМПТУ
    let finalInitialPrompt = storyPrompt
      .replace(/{title}/gi, title)
      .replace(/{language}/gi, language)
      .replace(/{length}/gi, targetLength || '25000')
      .replace(/{projectName}/gi, projectName)

    // 🔥 ПОКРАЩЕНІ ПРАВИЛА (Вибір режиму)
    let systemRules = ''

    if (onePartStory) {
      // === ПРАВИЛА ДЛЯ ОДНІЄЇ ЧАСТИНИ ===
      systemRules = `
        \n\nSYSTEM RULES (MUST FOLLOW):
        1. Write the COMPLETE story in ONE SINGLE RESPONSE.
        2. Write a full, finished story from start to end.
        3. CRITICAL: WRITE ONLY IN THIS LANGUAGE: ${language}.
        4. No markdown headers (like # Chapter 1).
      `
    } else {
      // === СТАРІ ПРАВИЛА (ЧАСТИНАМИ) ===
      systemRules = `
        \n\nSYSTEM RULES (MUST FOLLOW):
        1. Write the story in parts. Do NOT write the whole story at once.
        2. At the end of a part, write exactly "CONTINUE" if not finished.
        3. If the story is completely finished, write exactly "END".
        4. CRITICAL: WRITE THE STORY ONLY IN THIS LANGUAGE: ${language}.
        5. No markdown headers (like # Chapter 1).
      `
    }

    // Перше повідомлення
    let nextMessage = finalInitialPrompt + systemRules

    const chat = model.startChat({ history: [] })
    let fullStoryText = ''
    let isFinished = false
    let iteration = 0

    // 4. ЦИКЛ ГЕНЕРАЦІЇ
    while (!isFinished && iteration < 70) {
      iteration++
      sendLog(`✍️ Writing part ${iteration} (Lang: ${language})...`)

      console.log(`\n🔵 === AI PROMPT (Iteration ${iteration}) ===`)
      console.log(nextMessage) // Виводить повний текст промпту
      console.log('===========================================\n')

      try {
        const result = await chat.sendMessage(nextMessage)
        const rawText = result.response.text()

        // 🔥 ОЧИСТКА ТЕКСТУ
        let cleanChunk = rawText
          .replace(/CONTINUE/gi, '')
          .replace(/END/gi, '')
          .replace(/Type .*? to receive the next part\.?/gi, '')
          .replace(/Type .*? to continue\.?/gi, '')
          .replace(/\(Write .*?\)/gi, '')
          .replace(/\*\*/g, '')
          .replace(/##/g, '')
          .trim()

        if (cleanChunk) {
          fullStoryText += cleanChunk + '\n\n'
        }

        // --- УМОВА ВИХОДУ ---
        if (onePartStory) {
          // Логіка для "One Part Story"
          // Якщо AI не написав явно "CONTINUE", ми вважаємо, що він закінчив
          if (!rawText.includes('CONTINUE')) {
            isFinished = true
            sendLog('✅ One-part story finished.')
          }
        } else {
          // Стара логіка (Mult-part)
          // Шукаємо слово "END"
          if (rawText.includes('END')) {
            isFinished = true
            sendLog('✅ Story finished by AI.')
          }
        }

        // --- ПІДГОТОВКА НАСТУПНОГО КРОКУ (ЯКЩО НЕ ЗАКІНЧИЛИ) ---
        if (!isFinished) {
          nextMessage = `
            Great. Now write the NEXT part of the story. 
            - Move the plot forward. 
            - Do NOT repeat scenes.
            - Keep using language: ${language}.
            (Remember: do not write the end until the story is fully resolved)
          `
          await sleep(2000)
        }
      } catch (err) {
        console.error(`Generation Error at part ${iteration}:`, err)
        break
      }
    }

    // 5. ЗБЕРЕЖЕННЯ
    const finalContent = fullStoryText.trim()
    if (!finalContent) throw new Error('AI produced empty text.')

    await fs.writeFile(join(finalPath, 'story.txt'), finalContent)

    // 6. SEO
    sendLog('📝 Generating SEO...')
    try {
      const seoTemplate =
        seoPrompt ||
        `Based on the story above, write YouTube Title, Description, Hashtags. Language: ${language}.`

      const finalSeoPrompt = seoTemplate.replace(/{title}/gi, title)

      const descRes = await chat.sendMessage(finalSeoPrompt)
      await fs.writeFile(join(finalPath, 'description.txt'), descRes.response.text().trim())
    } catch (e) {
      console.warn('SEO gen failed', e)
    }

    // 7. ІСТОРІЯ
    const history = store.get('generationHistory', [])
    history.unshift({
      title: projectName,
      projectName,
      path: finalPath,
      date: new Date().toLocaleString()
    })
    store.set('generationHistory', history.slice(0, 50))

    return { success: true, textToSpeak: finalContent, folderPath: finalPath }
  } catch (error) {
    console.error('Story Gen Error:', error)
    return { success: false, error: error.message }
  }
})

// STAGE 2: Audio, Images, Video
// --- IPC HANDLER: GENERATE AUDIO ONLY (UPDATED) ---

// Мапа мов для Whisper (Додай це перед функцією або на початку файлу)
const LANGUAGE_CODES = {
  English: 'en',
  Ukrainian: 'uk',
  German: 'de',
  Spanish: 'es',
  French: 'fr'
  // Можеш додати інші мови, якщо вони є в твоєму select
}

ipcMain.handle('generate-audio-only', async (event, data) => {
  // Деструктуризація з новими полями: visualMode, bgVideoPath, language
  const {
    text,
    voice,
    ttsProvider,
    folderPath,
    imagePrompt,
    imageCount,
    visualMode,
    bgVideoPath,
    language,
    makeSubtitles
  } = data

  try {
    // Зберігаємо фінальний текст скрипта
    await fs.writeFile(join(folderPath, 'final_script_for_audio.txt'), text)

    // ==========================================
    // КРОК 1: ВІЗУАЛЬНИЙ КОНТЕНТ (КАРТИНКИ АБО ВІДЕО)
    // ==========================================

    if (visualMode === 'video') {
      // --- РЕЖИМ ВІДЕО ---
      sendLog('🎬 Video Mode Selected. Skipping image generation.')

      if (!bgVideoPath) {
        throw new Error('Background video file not selected!')
      }
      if (!fs.existsSync(bgVideoPath)) {
        throw new Error(`Video file not found at: ${bgVideoPath}`)
      }

      // Копіюємо відео у папку проєкту як "source_bg.mp4"
      const destVideoPath = join(folderPath, 'source_bg.mp4')
      sendLog(`📂 Copying background video to project folder...`)
      await fs.copy(bgVideoPath, destVideoPath)
    } else {
      // --- РЕЖИМ КАРТИНОК (Стара логіка) ---
      const imagesDir = join(folderPath, 'images')
      await fs.ensureDir(imagesDir)

      let countToGen = parseInt(imageCount)
      if (isNaN(countToGen) || countToGen < 1) countToGen = 1

      const finalImagePrompt = imagePrompt || 'Atmospheric cinematic background, 8k, detailed'

      sendLog(`🎨 Starting Image Generation: Count=${countToGen}...`)

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
        await sleep(1000) // Пауза між запитами
      }

      // Перевірка, чи створились картинки
      const files = await fs.readdir(imagesDir)
      if (files.filter((f) => f.endsWith('.jpg')).length === 0) {
        sendLog('⚠️ WARNING: No images generated! Creating a dummy image...')
        // Тут можна додати логіку створення заглушки, якщо треба
      }
    }

    // ==========================================
    // КРОК 2: ГЕНЕРАЦІЯ АУДІО
    // ==========================================
    const audioPath = join(folderPath, 'audio.mp3')

    if (ttsProvider === 'genai') {
      const gToken = store.get('genAiKey')
      if (!gToken) throw new Error('GenAI Token missing!')
      await generateGenAiAudio(text, voice, gToken, audioPath)
    } else if (ttsProvider === '11labs') {
      const eToken = store.get('elevenAudioKey')
      if (!eToken) throw new Error('11 Labs Audio Key is missing!')
      await generate11LabsAudio(text, voice, eToken, audioPath)
    } else {
      // --- NODE-EDGE-TTS (З підтримкою довгих текстів) ---
      sendLog('🎙️ Generating Edge TTS Audio (Long Text Mode)...')

      try {
        // 1. Налаштування
        const tts = new EdgeTTS({
          voice: voice,
          lang: 'en-US',
          outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
          timeout: 60000 // 1 хвилина на кожен маленький шматок (цього достатньо)
        })

        // 2. Розбиваємо текст на частини
        const chunks = splitTextSafe(text, 2500)
        const totalChunks = chunks.length
        sendLog(`ℹ️ Text split into ${totalChunks} parts. Starting generation...`)

        // 3. Очищаємо (або створюємо) фінальний файл
        await fs.writeFile(audioPath, '') // Створюємо пустий файл

        // 4. Цикл генерації
        for (let i = 0; i < totalChunks; i++) {
          const chunk = chunks[i]
          const tempChunkPath = join(folderPath, `temp_part_${i}.mp3`)

          sendLog(`🎙️ Processing part ${i + 1}/${totalChunks}...`)

          // Генеруємо шматок у тимчасовий файл
          await tts.ttsPromise(chunk, tempChunkPath)

          // Читаємо згенерований шматок і дописуємо в кінець основного файлу
          const chunkData = await fs.readFile(tempChunkPath)
          await fs.appendFile(audioPath, chunkData)

          // Видаляємо тимчасовий файл, щоб не смітити
          await fs.unlink(tempChunkPath).catch(() => {})

          // Маленька пауза, щоб не "душити" сервер Microsoft запитами
          await sleep(500)
        }

        sendLog('✅ Full Edge TTS Audio generated successfully.')
      } catch (e) {
        console.error('NodeEdgeTTS Error:', e)
        throw new Error(`Edge TTS failed at some part: ${e.message}`)
      }
    }

    // ==========================================
    // КРОК 3: СУБТИТРИ (WHISPER)
    // ==========================================
    const srtPath = join(folderPath, 'subtitles.srt')

    // Check the checkbox value
    if (makeSubtitles === true) {
      sendLog('📝 Generating Subtitles with Whisper (Local)...')
      const whisperLangCode = LANGUAGE_CODES[language] || 'auto'

      const srtGenerated = await generateSrtWithWhisper(audioPath, srtPath, whisperLangCode)

      if (srtGenerated) {
        // Only add effects if SRT was actually created
        await addFadeEffectToSrt(srtPath)
      }
    } else {
      sendLog('⏭️ Skipping Subtitles (User unchecked).')
      if (fs.existsSync(srtPath)) {
        await fs.unlink(srtPath)
      }
    }

    // ==========================================
    // КРОК 4: РЕНДЕР ВІДЕО
    // ==========================================
    // Передаємо visualMode, щоб функція знала, що рендерити (луп чи слайдшоу)
    await createVideoFromProject(folderPath, visualMode)

    sendLog('✅ All processes completed!')
    shell.openPath(folderPath)
    return { success: true }
  } catch (error) {
    console.error('Stage 2 Error:', error)
    return { success: false, error: error.message }
  }
})
function hexToAssColor(hex) {
  if (!hex) return '&H00FFFFFF'
  const clean = hex.replace('#', '')
  const r = clean.substring(0, 2)
  const g = clean.substring(2, 4)
  const b = clean.substring(4, 6)
  return `&H00${b}${g}${r}`.toUpperCase()
}
