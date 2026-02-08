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
 * Конвертує JSON Whisper в ASS з плавною анімацією (\kf)
 */
export async function convertWhisperJsonToAss(jsonPath, assPath, options = {}) {
  try {
    // 1. НАЛАШТУВАННЯ СТИЛЮ
    // Логіка караоке ASS: текст стоїть у SecondaryColour, а зафарбовується у PrimaryColour.
    // Тому: Primary = Активний (Жовтий), Secondary = Пасивний (Білий)

    const style = {
      fontSize: options.fontSize || 60,
      primaryColor: options.primaryColor || '&H0000FFFF', // ЖОВТИЙ (Колір, ЯКИМ зафарбовуємо)
      secondaryColor: options.secondaryColor || '&H00FFFFFF', // БІЛИЙ (Колір тексту до того, як його сказали)
      outlineColor: options.outlineColor || '&H00000000', // Чорна обводка
      marginV: options.marginV || 150, // Відступ знизу
      marginSide: options.marginSide || 400, // Відступи з боків (центрування)
      maxChars: options.maxChars || 30 // Довжина рядка
    }

    const data = await fs.readJson(jsonPath)

    let rawSegments = data.segments || data.transcription
    if (!rawSegments) throw new Error('Invalid Whisper JSON: No segments found')

    // 2. Очищення даних
    const words = rawSegments
      .map((s) => {
        let start = s.start
        let end = s.end
        if (s.timestamps) {
          start = parseTime(s.timestamps.from)
          end = parseTime(s.timestamps.to)
        }
        return {
          text: s.text,
          start: start,
          end: end
        }
      })
      .filter((w) => w.text)

    // 3. HEADER ASS
    const header = `[Script Info]
Title: Karaoke Story
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke,Arial,${style.fontSize},${style.primaryColor},${style.secondaryColor},${style.outlineColor},&H00000000,-1,0,1,3,0,2,${style.marginSide},${style.marginSide},${style.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
    let events = []

    // 4. ГРУПУВАННЯ ТА АНІМАЦІЯ
    let currentLine = []
    let currentLength = 0
    const MAX_LINE_CHARS = style.maxChars

    function flushLine() {
      if (currentLine.length === 0) return

      const lineStart = currentLine[0].start
      const lineEnd = currentLine[currentLine.length - 1].end

      let assLine = ''

      currentLine.forEach((w) => {
        const duration = w.end - w.start
        const kDuration = Math.round(duration * 100)

        // ЗМІНА ТУТ: \\kf замість \\k
        // \\kf робить плавну заливку зліва направо (sweep)
        assLine += `{\\kf${kDuration}}${w.text}`
      })

      // Додаємо \\fad(300,200) на початок рядка
      // Це робить плавну появу (300мс) і зникнення (200мс) всього тексту
      events.push(
        `Dialogue: 0,${formatAssTime(lineStart)},${formatAssTime(lineEnd)},Karaoke,,0,0,0,,{\\fad(300,200)}${assLine}`
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
