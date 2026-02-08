import { GoogleGenerativeAI } from '@google/generative-ai'
import fs from 'fs-extra'
import { join } from 'path'
import Store from 'electron-store'
import { sleep } from '../utils/helpers.js'

const store = new Store()

export async function generateStoryWithGemini(data, logFn = console.log) {
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

  const apiKey = store.get('apiKey')
  if (!apiKey) throw new Error('Gemini API Key is missing.')

  if (!storyPrompt) throw new Error('Template (storyPrompt) is missing!')

  const genAI = new GoogleGenerativeAI(apiKey)
  const selectedModel = modelName || 'gemini-2.0-flash'
  const model = genAI.getGenerativeModel({ model: selectedModel })

  const safeProjectName = projectName
    .replace(/[а-яА-ЯіІїЇєЄґҐ]/g, 'ua')
    .replace(/[^a-zA-Z0-9]/g, '_')

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const folderName = `${safeProjectName}_${timestamp}`
  const finalPath = join(outputFolder, folderName)

  await fs.ensureDir(finalPath)

  logFn('✍️ Starting Story Generation...')

  let finalInitialPrompt = storyPrompt
    .replace(/{title}/gi, title)
    .replace(/{language}/gi, language)
    .replace(/{length}/gi, targetLength || '25000')
    .replace(/{projectName}/gi, projectName)

  let systemRules = ''
  if (onePartStory) {
    systemRules = `\n\nSYSTEM RULES:\n1. Write COMPLETE story in ONE RESPONSE.\n2. Lang: ${language}.\n3. No markdown headers.`
  } else {
    systemRules = `\n\nSYSTEM RULES:\n1. Write in parts. End part with "CONTINUE".\n2. Finish with "END".\n3. Lang: ${language}.\n4. No markdown headers.`
  }

  let nextMessage = finalInitialPrompt + systemRules
  const chat = model.startChat({ history: [] })
  let fullStoryText = ''
  let isFinished = false
  let iteration = 0

  while (!isFinished && iteration < 70) {
    iteration++
    logFn(`✍️ Writing part ${iteration} (Lang: ${language})...`)

    try {
      const result = await chat.sendMessage(nextMessage)
      const rawText = result.response.text()

      let cleanChunk = rawText
        .replace(/CONTINUE/gi, '')
        .replace(/END/gi, '')
        .replace(/\*\*/g, '')
        .replace(/##/g, '')
        .trim()

      if (cleanChunk) fullStoryText += cleanChunk + '\n\n'

      if (onePartStory) {
        if (!rawText.includes('CONTINUE')) {
          isFinished = true
          logFn('✅ One-part story finished.')
        }
      } else {
        if (rawText.includes('END')) {
          isFinished = true
          logFn('✅ Story finished by AI.')
        }
      }

      if (!isFinished) {
        nextMessage = `Great. Write NEXT part. Move plot forward. Lang: ${language}.`
        await sleep(2000)
      }
    } catch (err) {
      console.error(`Generation Error part ${iteration}:`, err)
      break
    }
  }

  const finalContent = fullStoryText.trim()
  if (!finalContent) throw new Error('AI produced empty text.')

  await fs.writeFile(join(finalPath, 'story.txt'), finalContent)

  // SEO
  logFn('📝 Generating SEO...')
  try {
    const seoTemplate =
      seoPrompt || `Write YouTube Title, Description, Hashtags. Lang: ${language}.`
    const finalSeoPrompt = seoTemplate.replace(/{title}/gi, title)
    const descRes = await chat.sendMessage(finalSeoPrompt)
    await fs.writeFile(join(finalPath, 'description.txt'), descRes.response.text().trim())
  } catch (e) {
    console.warn('SEO gen failed', e)
  }

  // History
  const history = store.get('generationHistory', [])
  history.unshift({
    title: projectName,
    projectName,
    path: finalPath,
    date: new Date().toLocaleString()
  })
  store.set('generationHistory', history.slice(0, 50))

  return { success: true, textToSpeak: finalContent, folderPath: finalPath }
}
