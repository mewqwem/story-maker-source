/**
 * Module: Generator
 * Handles the core story generation workflow, voice selection, and status updates.
 */

import { showToast } from './ui.js'
import { getFavorites, getPromptText, getSeoPromptText } from './library.js'

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
  { name: 'Elvira (ES)', value: 'es-ES-ElviraNeural' }
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

  // 6. Listen for Favorites Updates (NEW)
  window.addEventListener('favorites-updated', () => {
    updateVoiceList()
  })
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
  } else {
    // GenAI / Custom Voices
    const favorites = getFavorites()
    const filteredFavs = favorites.filter((v) => v.language === langCode || v.language === 'all')

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

// ... (Rest of the file: startProcess, confirmAudioGeneration, setupStatusSystem remains same)
// Just keep the rest of your generator.js file code here
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

  // Validation
  if (!projectName || !title || !outputFolder) {
    return showToast('❌ Fill Project Name, Title and Output Folder!', 'error')
  }
  if (!templateKey) {
    return showToast('❌ Please select a Story Template from the list!', 'error')
  }

  // Get content from Library getters
  const templateText = getPromptText(templateKey)
  const seoPrompt = getSeoPromptText(seoTemplateKey)

  if (!templateText) {
    return showToast('❌ Error: Template content not found.', 'error')
  }

  // UI Updates
  const btn = document.getElementById('btnStart')
  if (btn) {
    btn.disabled = true
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> WORKING...'
  }

  const popFolder = document.getElementById('pop-folder')
  if (popFolder) popFolder.innerText = outputFolder

  const popDetails = document.getElementById('pop-details')
  if (popDetails) popDetails.innerHTML = ''

  const popMsg = document.getElementById('pop-msg')
  if (popMsg) popMsg.innerText = 'Starting...'

  const payload = {
    projectName,
    templateText,
    seoPrompt,
    title,
    language,
    outputFolder,
    modelName,
    targetLength
  }

  try {
    // IPC Call to Main Process
    const result = await window.api.generateStoryText(payload)

    if (result.success) {
      // Store data for next step
      tempGenerationData = {
        folderPath: result.folderPath,
        voice: document.getElementById('voice').value,
        ttsProvider: document.getElementById('ttsProvider').value
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
    // Reset button state
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
      folderPath: tempGenerationData.folderPath
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
  // Listen for log updates from Main Process
  window.api.onLogUpdate((msg) => {
    updateStatusDisplay(msg)
  })

  // Status Indicator Click (Toggle Popover)
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

  // Safe check
  if (popMsg) popMsg.innerText = msg

  addDetailLog(msg, type)

  if (!indicator) return // Exit if no indicator found

  // Update Indicator Color/Icon logic
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
