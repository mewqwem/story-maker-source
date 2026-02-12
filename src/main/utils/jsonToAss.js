import fs from 'fs-extra'

function parseTime(t) {
  if (typeof t === 'number') return t
  if (typeof t === 'string') {
    const [h, m, sWithMs] = t.split(':')
    const [s, ms] = sWithMs.split(',')
    return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000
  }
  return 0
}

function formatAssTime(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
}

/**
 * Конвертує JSON Whisper в ASS (STATIC LINES - без караоке, просто текст)
 */
export async function convertWhisperJsonToAss(jsonPath, assPath, options = {}) {
  try {
    const style = {
      font: options.font || 'Arial',
      fontSize: options.fontSize || 60,
      // Тепер Active Color - це єдиний колір тексту
      textColor: options.activeColor || '&H00FFFFFF',
      outlineColor: options.outlineColor || '&H00000000',
      outlineWidth: options.outlineWidth || 2,
      marginV: options.marginV || 150,
      marginSide: options.marginSide || 400,
      maxChars: options.maxChars || 30,
      bold: options.bold ? -1 : 0,
      italic: options.italic ? -1 : 0
    }

    const data = await fs.readJson(jsonPath)
    let rawSegments = data.segments || data.transcription
    if (!rawSegments) throw new Error('Invalid Whisper JSON')

    // Отримуємо слова (або сегменти, якщо слів немає)
    let words = []
    const hasWordTimestamps = rawSegments.some((s) => s.words && s.words.length > 0)

    if (hasWordTimestamps) {
      rawSegments.forEach((seg) => {
        if (seg.words) {
          seg.words.forEach((w) => {
            words.push({
              text: w.word || w.text,
              start: w.start,
              end: w.end
            })
          })
        }
      })
    } else {
      words = rawSegments
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
    }

    // ЗАГОЛОВОК
    // PrimaryColour встановлюємо в style.textColor (твій вибраний колір)
    const header = `[Script Info]
Title: Static Story Subtitles
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.font},${style.fontSize},${style.textColor},&H00FFFFFF,${style.outlineColor},&H00000000,${style.bold},${style.italic},1,${style.outlineWidth},0,2,${style.marginSide},${style.marginSide},${style.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
    let events = []
    let currentLine = []
    let currentLength = 0
    const MAX_LINE_CHARS = style.maxChars

    function flushLine() {
      if (currentLine.length === 0) return

      const lineStart = currentLine[0].start
      const lineEnd = currentLine[currentLine.length - 1].end + 0.1 // +0.1 щоб не мигало

      // Просто з'єднуємо слова в речення
      const lineText = currentLine.map((w) => w.text.trim()).join(' ')

      // Генеруємо подію без тегів караоке (\k, \t), лише \fad
      events.push(
        `Dialogue: 0,${formatAssTime(lineStart)},${formatAssTime(lineEnd)},Default,,0,0,0,,{\\fad(150,150)}${lineText}`
      )

      currentLine = []
      currentLength = 0
    }

    for (let i = 0; i < words.length; i++) {
      const word = words[i]
      // Проста логіка розбиття на рядки
      if (currentLength + word.text.length > MAX_LINE_CHARS) {
        flushLine()
      }
      currentLine.push(word)
      currentLength += word.text.length + 1 // +1 за пробіл
    }
    flushLine()

    await fs.writeFile(assPath, header + events.join('\n'))
    return true
  } catch (error) {
    console.error('ASS Conversion Error:', error)
    throw error
  }
}
