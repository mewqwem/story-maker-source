// src/main/services/whisperService.js
import { join, dirname } from 'path'
import fs from 'fs-extra'
import { exec } from 'child_process'
import { promisify } from 'util'
import { app } from 'electron'
import Store from 'electron-store'

const execPromise = promisify(exec)
const store = new Store()

/**
 * Генерує SRT субтитри використовуючи Whisper
 * @param {string} audioPath - Шлях до аудіо файлу
 * @param {string} srtPath - Куди зберегти SRT
 * @param {string} languageCode - Код мови (en, uk, etc.)
 * @param {function} logFn - Функція для логування в UI
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
    // Визначаємо назву файлу залежно від ОС
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
        logFn(`ℹ️ Using Custom Whisper Path: ${binPath}`)
      } else {
        logFn(`⚠️ Custom path invalid. Reverting to default: ${defaultBinPath}`)
      }
    } else {
      logFn(`ℹ️ Using Default Whisper Path: ${binPath}`)
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

    logFn('🎙️ Converting audio to 16kHz WAV...')
    const convertCmd = `"${ffmpegCmd}" -y -i "${audioPath}" -ar 16000 -ac 1 -c:a pcm_s16le -map_metadata -1 -fflags +bitexact "${tempWavPath}"`
    await execPromise(convertCmd)

    // Запуск Whisper
    const outputBase = 'subtitles' // Whisper сам додасть розширення

    // Тут ми використовуємо знайдені шляхи
    const runCmd = `"${whisperExe}" -m "${modelPath}" -f "${tempWavName}" -osrt -of "${outputBase}" -l ${languageCode} --max-len 40`

    logFn('🎙️ Running Whisper AI (Max-len 60)...')
    await execPromise(runCmd, { cwd: workDir })

    // Чистка і перевірка
    fs.unlink(tempWavPath).catch(() => {})
    const generatedFile = join(workDir, outputBase + '.srt')

    if (fs.existsSync(generatedFile)) {
      if (generatedFile !== srtPath) await fs.move(generatedFile, srtPath, { overwrite: true })
      logFn('✅ SRT generated successfully.')
      return true
    } else {
      // Check fallback name
      const weirdFile = join(workDir, tempWavName + '.srt')
      if (fs.existsSync(weirdFile)) {
        await fs.move(weirdFile, srtPath, { overwrite: true })
        return true
      }
      console.warn('Whisper finished but no SRT file found (maybe silence).')
      return false
    }
  } catch (error) {
    console.error('Whisper Failed:', error)
    logFn(`⚠️ Whisper Error: ${error.message}`)
    return false
  }
}

/**
 * Додає ефект появи (fade) до субтитрів
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
