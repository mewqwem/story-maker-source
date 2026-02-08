import fs from 'fs-extra'
import axios from 'axios'
import { API_URLS } from '../config/constants.js'

export async function generateElevenLabsImage(prompt, token, outputPath) {
  try {
    const cleanToken = token.trim()
    const response = await axios.post(
      `${API_URLS.IMAGE}/image/create?as_file=true`,
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
    console.error('11Labs Image Error:', error.message)
    throw error
  }
}

export async function downloadPollinationsImage(prompt, outputPath) {
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
