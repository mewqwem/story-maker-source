import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import fs from 'fs-extra'
import Store from 'electron-store'
import log from 'electron-log'
import { autoUpdater } from 'electron-updater'

// --- SERVICES & CONFIG ---
import { API_URLS, LANGUAGE_CODES } from './config/constants.js'
import { sleep } from './utils/helpers.js'

import { generateStoryWithGemini } from './services/storyService.js'
import { generateElevenLabsImage, downloadPollinationsImage } from './services/imageService.js'
import {
  generateEdgeTtsAudio,
  generatePiperAudio,
  generate11LabsAudio,
  generateGenAiAudio
} from './services/audioService.js'
import { generateSrtWithWhisper, addFadeEffectToSrt } from './services/whisperService.js'
import { createVideoFromProject } from './services/videoService.js'

// --- SETUP ---
const store = new Store()

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
    setTimeout(() => autoUpdater.checkForUpdatesAndNotify(), 2000)
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

// --- APP EVENTS ---
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.storymaker.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// --- UPDATER & LOGS ---
const sendLog = (msg) => {
  if (mainWindow) mainWindow.webContents.send('log-update', msg)
}

autoUpdater.on('download-progress', (progress) => {
  if (mainWindow)
    mainWindow.webContents.send('log-update', `⬇️ Update: ${Math.round(progress.percent)}%`)
})
autoUpdater.on('update-downloaded', () => sendLog('ℹ️ Update Ready!'))

// --- IPC: SETTINGS ---
ipcMain.handle('get-setting', (event, key) => store.get(key, null))
ipcMain.handle('save-setting', (event, key, value) => {
  store.set(key, value)
  return true
})
ipcMain.handle('get-version', () => app.getVersion())
ipcMain.handle('get-history', () => store.get('generationHistory', []))
ipcMain.handle('clear-history', () => {
  store.set('generationHistory', [])
  return true
})
ipcMain.handle('open-folder', async (e, path) => shell.openPath(path))

// --- IPC: FILES ---
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})
ipcMain.handle('select-file', async (event, extensions = []) => {
  const filters =
    extensions.length > 0 ? [{ name: 'Files', extensions }] : [{ name: 'All', extensions: ['*'] }]
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters })
  return result.canceled ? null : result.filePaths[0]
})
ipcMain.handle('read-json', async (e, fp) => fs.readJson(fp).catch((e) => console.error(e) || null))
ipcMain.handle('write-json', async (e, fp, data) =>
  fs
    .writeJson(fp, data, { spaces: 2 })
    .then(() => true)
    .catch(() => false)
)

// --- IPC: GENERATION HANDLERS ---

// 1. GENERATE STORY (GEMINI)
ipcMain.handle('generate-story-text', async (event, data) => {
  try {
    return await generateStoryWithGemini(data, sendLog)
  } catch (error) {
    console.error('Story Gen Error:', error)
    return { success: false, error: error.message }
  }
})

// 2. GENERATE AUDIO & VIDEO
ipcMain.handle('generate-audio-only', async (event, data) => {
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
    await fs.writeFile(join(folderPath, 'final_script_for_audio.txt'), text)

    // A. Visuals
    if (visualMode === 'video') {
      sendLog('🎬 Video Mode. Copying background...')
      if (!bgVideoPath || !fs.existsSync(bgVideoPath)) throw new Error('Background video missing!')
      await fs.copy(bgVideoPath, join(folderPath, 'source_bg.mp4'))
    } else {
      const imagesDir = join(folderPath, 'images')
      await fs.ensureDir(imagesDir)
      let count = parseInt(imageCount) || 1
      const finalPrompt = imagePrompt || 'Cinematic background, 8k'

      sendLog(`🎨 Generating ${count} images...`)
      const imgProvider = store.get('imageProvider') || 'free'
      const imgToken = store.get('elevenLabsImgKey')

      for (let i = 1; i <= count; i++) {
        const imgPath = join(imagesDir, `scene_${i}.jpg`)
        sendLog(`🎨 Image ${i}/${count}...`)
        try {
          if (imgProvider === 'eleven')
            await generateElevenLabsImage(finalPrompt, imgToken, imgPath)
          else await downloadPollinationsImage(finalPrompt, imgPath)
          sendLog(`✅ Image ${i} saved.`)
        } catch (e) {
          console.error(`Image ${i} failed`, e)
          sendLog(`⚠️ Image ${i} failed.`)
        }
        await sleep(1000)
      }
    }

    // B. Audio
    const audioPath = join(folderPath, 'audio.mp3')
    if (ttsProvider === 'genai') {
      await generateGenAiAudio(text, voice, store.get('genAiKey'), audioPath, sendLog)
    } else if (ttsProvider === '11labs') {
      await generate11LabsAudio(text, voice, store.get('elevenAudioKey'), audioPath, sendLog)
    } else if (ttsProvider === 'piper') {
      await generatePiperAudio(text, voice, folderPath, audioPath, sendLog)
    } else {
      await generateEdgeTtsAudio(text, voice, folderPath, audioPath, sendLog)
    }

    // C. Subtitles
    const srtPath = join(folderPath, 'subtitles.srt')
    if (makeSubtitles === true) {
      sendLog('📝 Generating Subtitles...')
      const langCode = LANGUAGE_CODES[language] || 'auto'
      const srtOk = await generateSrtWithWhisper(audioPath, srtPath, langCode, sendLog)
      if (srtOk) await addFadeEffectToSrt(srtPath)
    } else {
      sendLog('⏭️ Skipping Subtitles.')
      if (fs.existsSync(srtPath)) await fs.unlink(srtPath)
    }

    // D. Render Video
    await createVideoFromProject(folderPath, visualMode, sendLog)

    sendLog('✅ All processes completed!')
    shell.openPath(folderPath)
    return { success: true }
  } catch (error) {
    console.error('Process Error:', error)
    return { success: false, error: error.message }
  }
})
