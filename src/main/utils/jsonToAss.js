import fs from 'fs-extra'

// Хелпер для конвертації часу
function parseTime(t) {
  if (typeof t === 'number') return t
  if (typeof t === 'string') {
    const [h, m, sWithMs] = t.split(':')
    const [s, ms] = sWithMs.split(',')
    return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000
  }
  return 0
}

// Хелпер для форматування часу в ASS
function formatAssTime(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
}

/**
 * Конвертує JSON Whisper в ASS (SMOOTH WORD FADE - без зсуву часу)
 */
export async function convertWhisperJsonToAss(jsonPath, assPath, options = {}) {
  try {
    const style = {
      fontSize: options.fontSize || 60,
      activeColor: options.primaryColor || '&H0000FFFF', // Жовтий (Цільовий)
      inactiveColor: options.secondaryColor || '&H00FFFFFF', // Білий/Сірий (Базовий)
      outlineColor: options.outlineColor || '&H00000000',
      marginV: options.marginV || 150,
      marginSide: options.marginSide || 400,
      maxChars: options.maxChars || 30
    }

    const FADE_DURATION = 200 // 200мс на плавну зміну кольору слова

    const data = await fs.readJson(jsonPath)

    let rawSegments = data.segments || data.transcription
    if (!rawSegments) throw new Error('Invalid Whisper JSON: No segments found')

    const words = rawSegments
      .map((s) => {
        let start = s.start
        let end = s.end
        if (s.timestamps) {
          start = parseTime(s.timestamps.from)
          end = parseTime(s.timestamps.to)
        }
        return { text: s.text, start: start, end: end }
      })
      .filter((w) => w.text)

    // ВАЖЛИВО: PrimaryColour в стилі ставимо як INACTIVE (Базовий).
    // Текст з'явиться цим кольором.
    const header = `[Script Info]
Title: Smooth Fade Story
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke,Arial,${style.fontSize},${style.inactiveColor},${style.activeColor},${style.outlineColor},&H00000000,-1,0,1,3,0,2,${style.marginSide},${style.marginSide},${style.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
    let events = []

    // ГРУПУВАННЯ
    let currentLine = []
    let currentLength = 0
    const MAX_LINE_CHARS = style.maxChars

    function flushLine() {
      if (currentLine.length === 0) return

      // Час життя рядка - строго від початку першого слова до кінця останнього
      // Додаємо мікро-відступи (0.1с), щоб слова не обрізалися
      const lineStart = currentLine[0].start
      const lineEnd = currentLine[currentLine.length - 1].end + 0.1

      let assLine = ''

      currentLine.forEach((w) => {
        // Розраховуємо, коли саме всередині рядка має початися анімація слова
        // tStart = (Початок слова - Початок рядка)
        let tStart = Math.round((w.start - lineStart) * 1000)
        if (tStart < 0) tStart = 0

        const tEnd = tStart + FADE_DURATION

        // \t(t1, t2, \1c&HActiveColor&)
        // Це означає: "Починаючи з t1 і до t2 плавно зміни колір на Активний"
        // \1c - це код для зміни Primary Colour
        assLine += `{\\t(${tStart},${tEnd},\\1c${style.activeColor})}${w.text}`
      })

      // \fad(150,150) - плавна поява і зникнення всього рядка
      events.push(
        `Dialogue: 0,${formatAssTime(lineStart)},${formatAssTime(lineEnd)},Karaoke,,0,0,0,,{\\fad(150,150)}${assLine}`
      )

      currentLine = []
      currentLength = 0
    }

    for (let i = 0; i < words.length; i++) {
      const word = words[i]
      const isStartOfWord = word.text.startsWith(' ')

      if (currentLength + word.text.length > MAX_LINE_CHARS && isStartOfWord) {
        flushLine()
      }

      currentLine.push(word)
      currentLength += word.text.length
    }
    flushLine()

    await fs.writeFile(assPath, header + events.join('\n'))
    return true
  } catch (error) {
    console.error('ASS Conversion Error:', error)
    throw error
  }
}
