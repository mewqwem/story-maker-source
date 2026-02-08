/**
 * Module: Generator
 * Handles the core story generation workflow, voice selection, and status updates.
 */

import { showToast } from './ui.js'
import { getFavorites, getPromptText, getSeoPromptText, getImagePromptText } from './library.js'

// --- CONSTANTS ---
const LANG_CODE_MAP = {
  English: 'en',
  Ukrainian: 'uk',
  German: 'de',
  Spanish: 'es',
  French: 'fr'
}

const EDGE_VOICES = [
  { name: 'Christopher (US)', value: 'en-US-ChristopherNeural' },
  { name: 'Eric (US)', value: 'en-US-EricNeural' },
  { name: 'Jenny (US)', value: 'en-US-JennyNeural' },
  { name: 'Guy (US)', value: 'en-US-GuyNeural' },
  { name: 'Aria (US)', value: 'en-US-AriaNeural' },
  { name: 'Ostap (UA)', value: 'uk-UA-OstapNeural' },
  { name: 'Polina (UA)', value: 'uk-UA-PolinaNeural' },
  { name: 'Conrad (DE)', value: 'de-DE-ConradNeural' },
  { name: 'Katja (DE)', value: 'de-DE-KatjaNeural' },
  { name: 'Alvaro (ES)', value: 'es-ES-AlvaroNeural' },
  { name: 'Elvira (ES)', value: 'es-ES-ElviraNeural' },
  { name: 'Eloise (FR)', value: 'fr-FR-EloiseNeural' },
  { name: 'Henri (FR)', value: 'fr-FR-HenriNeural' }
]
const PIPER_VOICES = [
  { name: 'Thorsten (DE) - High', value: 'de_DE-thorsten-high.onnx', lang: 'de' }
]

// --- STATE ---
let tempGenerationData = null

// --- INITIALIZATION ---
export async function initGenerator() {
  setupGeneratorListeners()
  setupStatusSystem()

  const lastLang = await window.api.getSetting('lastLanguage')
  if (lastLang) {
    const langSel = document.getElementById('language')
    if (langSel) langSel.value = lastLang
  }

  await updateVoiceList()
}

// --- LOGIC ---

function setupGeneratorListeners() {
  // 1. Language Change
  const langSelect = document.getElementById('language')
  if (langSelect) {
    langSelect.addEventListener('change', async (e) => {
      await window.api.saveSetting('lastLanguage', e.target.value)
      updateVoiceList()
    })
  }

  // 2. TTS Provider Change
  const ttsToggles = document.querySelectorAll('#tts-toggles .toggle-option')
  ttsToggles.forEach((btn) => {
    btn.addEventListener('click', () => {
      setTimeout(updateVoiceList, 50)
    })
  })

  // 3. Start Button
  const btnStart = document.getElementById('btnStart')
  if (btnStart) {
    btnStart.addEventListener('click', startProcess)
  }

  // 4. Modal Buttons
  const btnCancelPreview = document.getElementById('btnCancelPreview')
  if (btnCancelPreview) {
    btnCancelPreview.addEventListener('click', () => {
      document.getElementById('previewModal').classList.remove('show')
      tempGenerationData = null
    })
  }

  const btnConfirmAudio = document.getElementById('btnConfirmAudio')
  if (btnConfirmAudio) {
    btnConfirmAudio.addEventListener('click', confirmAudioGeneration)
  }

  // 5. Preview Counter
  const previewArea = document.getElementById('previewTextarea')
  if (previewArea) {
    previewArea.addEventListener('input', (e) => {
      document.getElementById('charCountPreview').innerText = `Symbols: ${e.target.value.length}`
    })
  }

  // 6. Listen for Favorites Updates
  window.addEventListener('favorites-updated', () => {
    updateVoiceList()
  })

  // --- NEW: VISUAL MODE LISTENERS ---
  const btnModeImages = document.getElementById('btnModeImages')
  const btnModeVideo = document.getElementById('btnModeVideo')
  const panelImages = document.getElementById('settings-images-panel')
  const panelVideo = document.getElementById('settings-video-panel')
  const visualModeInput = document.getElementById('visualMode')
  const btnSelectBgVideo = document.getElementById('btnSelectBgVideo')
  const bgVideoPathDisplay = document.getElementById('bgVideoPathDisplay')

  if (btnModeImages && btnModeVideo) {
    btnModeImages.addEventListener('click', () => {
      btnModeImages.classList.add('active')
      btnModeVideo.classList.remove('active')
      panelImages.style.display = 'block'
      panelVideo.style.display = 'none'
      visualModeInput.value = 'images'
    })

    btnModeVideo.addEventListener('click', () => {
      btnModeVideo.classList.add('active')
      btnModeImages.classList.remove('active')
      panelImages.style.display = 'none'
      panelVideo.style.display = 'block'
      visualModeInput.value = 'video'
    })
  }

  if (btnSelectBgVideo) {
    btnSelectBgVideo.addEventListener('click', async () => {
      const filePath = await window.api.selectFile(['mp4', 'mov', 'avi', 'mkv'])
      if (filePath) {
        bgVideoPathDisplay.value = filePath
      }
    })
  }
}

export async function updateVoiceList() {
  const providerInput = document.getElementById('ttsProvider')
  const provider = providerInput ? providerInput.value : 'edge'

  const langSelect = document.getElementById('language')
  const langCode = LANG_CODE_MAP[langSelect.value] || ''

  const voiceSelect = document.getElementById('voice')
  if (!voiceSelect) return

  let voicesToRender = []

  if (provider === 'edge') {
    voicesToRender = EDGE_VOICES.filter((v) => v.value.startsWith(langCode))
  } else if (provider === 'piper') {
    voicesToRender = PIPER_VOICES.filter((v) => v.lang === langCode)
  } else {
    const favorites = getFavorites()
    const filteredFavs = favorites.filter((v) => {
      const isCorrectLang = v.language === langCode || v.language === 'all'
      if (provider === '11labs') return isCorrectLang && v.service === '11labs'
      return isCorrectLang && (v.service === 'genai' || !v.service)
    })

    voicesToRender = filteredFavs.map((v) => ({
      name: `⭐ ${v.name}`,
      value: v.voice_id
    }))
  }

  voiceSelect.innerHTML = voicesToRender.length ? '' : '<option disabled>No voices found</option>'
  voicesToRender.forEach((v) => {
    const opt = document.createElement('option')
    opt.value = v.value
    opt.innerText = v.name
    voiceSelect.appendChild(opt)
  })
}

// --- PROCESS: STEP 1 (TEXT GENERATION) ---
async function startProcess() {
  const projectName = document.getElementById('projectName').value
  const title = document.getElementById('storyTitle').value
  const templateKey = document.getElementById('selectedTemplate').value
  const seoTemplateKey = document.getElementById('selectedSeoTemplate').value
  const outputFolder = document.getElementById('outputFolderDisplay').value
  const targetLength = parseInt(document.getElementById('storyLength').value) || 25000
  const modelName = document.getElementById('modelSelect')?.value || 'gemini-2.0-flash'
  const language = document.getElementById('language').value
  const onePartStory = document.getElementById('onePartStory').checked

  // Get Visual Settings (Check Mode)
  const visualMode = document.getElementById('visualMode').value
  const imageTemplateKey = document.getElementById('selectedImageTemplate').value
  const bgVideoPath = document.getElementById('bgVideoPathDisplay').value

  // Validation
  if (!projectName || !title || !outputFolder) {
    return showToast('❌ Fill Project Name, Title and Output Folder!', 'error')
  }
  if (!templateKey) {
    return showToast('❌ Please select a Story Template!', 'error')
  }

  // Validate visual mode specific inputs
  if (visualMode === 'images' && !imageTemplateKey) {
    return showToast('❌ Please select an Image Style Template!', 'error')
  }
  if (visualMode === 'video' && !bgVideoPath) {
    return showToast('❌ Please select a Background Video file!', 'error')
  }

  // Get content from Library
  const templateText = getPromptText(templateKey)
  const seoPrompt = getSeoPromptText(seoTemplateKey)
  // Image prompt is only needed if mode is 'images'
  const imagePrompt = visualMode === 'images' ? getImagePromptText(imageTemplateKey) : ''

  if (!templateText) {
    return showToast('❌ Error: Template content not found in Library.', 'error')
  }

  // UI Updates
  const btn = document.getElementById('btnStart')
  if (btn) {
    btn.disabled = true
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> WORKING...'
  }

  // Reset logs logic...
  const popFolder = document.getElementById('pop-folder')
  if (popFolder) popFolder.innerText = outputFolder
  const popMsg = document.getElementById('pop-msg')
  if (popMsg) popMsg.innerText = 'Starting...'

  // Payload for TEXT generation
  const payload = {
    projectName,
    storyPrompt: templateText,
    seoPrompt,
    title,
    language,
    outputFolder,
    modelName,
    targetLength,
    onePartStory
  }

  try {
    const result = await window.api.generateStoryText(payload)

    if (result.success) {
      // Store data for next step (AUDIO & MEDIA)
      tempGenerationData = {
        folderPath: result.folderPath,
        voice: document.getElementById('voice').value,
        ttsProvider: document.getElementById('ttsProvider').value,
        imagePrompt: imagePrompt,
        imageCount: document.getElementById('totalImagesCount').value,
        makeSubtitles: document.getElementById('makeSubtitles').checked,
        onePartStory: document.getElementById('onePartStory').checked,
        language: language, // Pass language to fix Whisper!
        visualMode: visualMode,
        bgVideoPath: bgVideoPath
      }

      // Show Preview Modal
      const previewArea = document.getElementById('previewTextarea')
      previewArea.value = result.textToSpeak
      document.getElementById('charCountPreview').innerText =
        `Symbols: ${result.textToSpeak.length}`
      document.getElementById('previewModal').classList.add('show')
    } else {
      updateStatusDisplay(`❌ Text Error: ${result.error}`, 'error')
    }
  } catch (err) {
    console.error(err)
    updateStatusDisplay(`🛑 System Error: ${err.message}`, 'error')
  } finally {
    btn.disabled = false
    btn.innerHTML = '<i class="fa-solid fa-rocket"></i> <span>Start Generation</span>'
  }
}

// --- PROCESS: STEP 2 (AUDIO & MEDIA) ---
async function confirmAudioGeneration() {
  if (!tempGenerationData) return

  const finalUserData = document.getElementById('previewTextarea').value
  document.getElementById('previewModal').classList.remove('show')

  const btn = document.getElementById('btnStart')
  btn.disabled = true
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> GENERATING MEDIA...'

  try {
    const payload = {
      text: finalUserData,
      voice: tempGenerationData.voice,
      ttsProvider: tempGenerationData.ttsProvider,
      folderPath: tempGenerationData.folderPath,
      imagePrompt: tempGenerationData.imagePrompt,
      imageCount: tempGenerationData.imageCount,
      makeSubtitles: tempGenerationData.makeSubtitles,
      onePartStory: tempGenerationData.onePartStory,
      language: tempGenerationData.language,
      visualMode: tempGenerationData.visualMode,
      bgVideoPath: tempGenerationData.bgVideoPath
    }

    const result = await window.api.generateAudioOnly(payload)

    if (result.success) {
      updateStatusDisplay('✅ Project fully completed!', 'success')
      showToast('Project Completed Successfully', 'success')
    } else {
      updateStatusDisplay(`❌ Media Error: ${result.error}`, 'error')
    }
  } catch (e) {
    updateStatusDisplay(`❌ Critical Error: ${e.message}`, 'error')
  } finally {
    btn.disabled = false
    btn.innerHTML = '<i class="fa-solid fa-rocket"></i> <span>Start Generation</span>'
    tempGenerationData = null
  }
}

// --- STATUS SYSTEM ---
function setupStatusSystem() {
  window.api.onLogUpdate((msg) => {
    updateStatusDisplay(msg)
  })

  const statusInd = document.getElementById('status-indicator')
  if (statusInd) {
    statusInd.onclick = () => {
      document.getElementById('status-popover').classList.toggle('hidden')
    }
  }
}

function updateStatusDisplay(msg, type = 'normal') {
  const indicator = document.getElementById('status-indicator')
  const popMsg = document.getElementById('pop-msg')

  if (popMsg) popMsg.innerText = msg
  addDetailLog(msg, type)

  if (!indicator) return

  if (msg.includes('⚠️') || type === 'warning') {
    indicator.className = 'status-indicator warning'
  } else if (
    msg.includes('❌') ||
    msg.includes('🛑') ||
    msg.includes('Error') ||
    type === 'error'
  ) {
    indicator.className = 'status-indicator error'
    showToast(msg, 'error')
  } else if (msg.includes('✅') || type === 'success') {
    indicator.className = 'status-indicator success'
  } else {
    indicator.className = 'status-indicator processing'
  }
}

function addDetailLog(msg, type) {
  const details = document.getElementById('pop-details')
  if (!details) return

  const div = document.createElement('div')
  div.className = `log-item ${type === 'error' ? 'log-error' : ''}`
  div.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`
  details.prepend(div)
}
