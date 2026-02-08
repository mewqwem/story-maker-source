export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function formatTimeSRT(seconds) {
  const date = new Date(0)
  date.setMilliseconds(seconds * 1000)
  const hh = date.getUTCHours().toString().padStart(2, '0')
  const mm = date.getUTCMinutes().toString().padStart(2, '0')
  const ss = date.getUTCSeconds().toString().padStart(2, '0')
  const ms = date.getUTCMilliseconds().toString().padStart(3, '0')
  return `${hh}:${mm}:${ss},${ms}`
}

export function hexToAssColor(hex) {
  if (!hex) return '&H00FFFFFF'
  const clean = hex.replace('#', '')
  const r = clean.substring(0, 2)
  const g = clean.substring(2, 4)
  const b = clean.substring(4, 6)
  return `&H00${b}${g}${r}`.toUpperCase()
}

export function splitTextSafe(text, maxLength = 2500) {
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
