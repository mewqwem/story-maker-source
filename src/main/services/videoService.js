// src/main/services/videoService.js
import { join } from 'path'
import fs from 'fs-extra'
import { exec } from 'child_process'
import { promisify } from 'util'
import Store from 'electron-store'
import { hexToAssColor } from '../utils/helpers.js'

const execPromise = promisify(exec)
const store = new Store()

/**
 * Отримання тривалості аудіо
 */
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

/**
 * Створює фінальне відео з аудіо, картинок та субтитрів
 */
export async function createVideoFromProject(
  folderPath,
  visualMode = 'images',
  logFn = console.log
) {
  try {
    const audioName = 'audio.mp3'
    const videoName = 'video.mp4'
    const srtName = 'subtitles.srt'

    const audioPath = join(folderPath, audioName)
    const srtPath = join(folderPath, srtName)

    let ffmpegCmd = store.get('customFfmpegPath') || 'ffmpeg'
    ffmpegCmd = ffmpegCmd.replace(/"/g, '')

    // Налаштування стилів субтитрів
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

    logFn('🎬 Analyzing audio length...')
    const audioDuration = await getAudioDuration(audioPath, ffmpegCmd)
    logFn(`ℹ️ Audio Duration: ${audioDuration}s`)

    let subtitlesFilter = ''
    if (fs.existsSync(srtPath)) {
      subtitlesFilter = `,subtitles='${srtName}':charenc=UTF-8:force_style='${styleASS}'`
    }

    const execOptions = { cwd: folderPath }

    // ============================
    // РЕЖИМ 1: ВІДЕО-ЛУП
    // ============================
    if (visualMode === 'video') {
      const bgVideo = 'source_bg.mp4'
      if (!fs.existsSync(join(folderPath, bgVideo))) throw new Error('Source video missing!')

      logFn('🎬 Rendering looped video with subtitles...')

      const filter = `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1${subtitlesFilter}`
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

      logFn(`🎬 Found ${uniqueImages.length} images for video.`)

      if (uniqueImages.length === 1) {
        // Одне фото
        const relImgPath = `images/${uniqueImages[0]}`

        let filter = 'format=yuv420p'
        if (fs.existsSync(srtPath)) {
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
          filter += `${lastLabel}format=yuv420p[v_pre];[v_pre]subtitles='${srtName}':charenc=UTF-8:force_style='${styleASS}'[v]`
        } else {
          filter += `${lastLabel}format=yuv420p[v]`
        }

        const command = `"${ffmpegCmd}" -y ${inputs} -i "${audioName}" -filter_complex "${filter}" -map "[v]" -map ${inputFilesList.length}:a -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -shortest "${videoName}"`
        await execPromise(command, execOptions)
      }
    }

    logFn('🚀 Video Rendered Successfully: video.mp4')
  } catch (err) {
    logFn(`⚠️ Video Render Error: ${err.message}`)
    console.error(err)
    throw err // Прокидаємо помилку, щоб index.js знав про неї
  }
}
