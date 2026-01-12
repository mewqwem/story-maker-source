/**
 * Module: Settings
 * Handles loading and saving of user configuration (API keys, paths, AI Engine).
 */

import { showToast } from './ui.js'

export async function initSettings() {
  await loadSettingsData()
  setupSettingsListeners()
  setupAiEngineListeners() // <--- Added this
}

async function loadSettingsData() {
  // Helper to fetch setting from Electron Store
  const get = async (key) => await window.api.getSetting(key)

  const fill = async (key, id) => {
    try {
      const val = await get(key)
      const el = document.getElementById(id)
      if (el && val) el.value = val
    } catch (e) {
      console.error(`Failed to load setting: ${key}`, e)
    }
  }

  // 1. Credentials & Paths
  await fill('apiKey', 'apiKeyInput')
  await fill('genAiKey', 'genAiKeyInput')
  await fill('elevenLabsImgKey', 'elevenLabsImgKeyInput')
  await fill('outputDir', 'outputFolderDisplay')
  await fill('customFfmpegPath', 'ffmpegPathDisplay')
  await fill('promptPath', 'promptFileDisplay')
  await fill('seoPromptPath', 'seoPromptFileDisplay')
  await fill('edgeTtsPath', 'edgeTtsPathInput')

  // 2. AI Engine State Loading

  // TTS Provider
  const ttsProvider = (await get('ttsProvider')) || 'edge'
  const ttsInput = document.getElementById('ttsProvider')
  if (ttsInput) ttsInput.value = ttsProvider
  updateToggleState('tts-toggles', ttsProvider)

  // Image Provider
  const imgProvider = (await get('imageProvider')) || 'free'
  const imgInput = document.getElementById('imageProvider')
  if (imgInput) imgInput.value = imgProvider
  updateToggleState('image-toggles', imgProvider)

  // Gemini Model
  const lastModel = await get('lastModel')
  if (lastModel) {
    const modelSelect = document.getElementById('modelSelect')
    if (modelSelect) modelSelect.value = lastModel
  }
}

// --- Listeners ---

function setupSettingsListeners() {
  const bindSave = (btnId, inputId, settingKey, msg) => {
    const btn = document.getElementById(btnId)
    const input = document.getElementById(inputId)
    if (btn && input) {
      btn.addEventListener('click', async () => {
        await window.api.saveSetting(settingKey, input.value.trim())
        showToast(msg, 'success')
      })
    }
  }

  const bindToggle = (btnId, inputId) => {
    const btn = document.getElementById(btnId)
    const input = document.getElementById(inputId)
    if (btn && input) {
      btn.addEventListener('click', () => {
        input.type = input.type === 'password' ? 'text' : 'password'
      })
    }
  }

  // Save Buttons
  bindSave('btnSaveKey', 'apiKeyInput', 'apiKey', 'Gemini Key Saved!')
  bindSave('btnSaveGenAiKey', 'genAiKeyInput', 'genAiKey', 'GenAI Token Saved!')
  bindSave(
    'btnSaveElevenLabsImgKey',
    'elevenLabsImgKeyInput',
    'elevenLabsImgKey',
    '11Labs Token Saved!'
  )
  bindSave('btnSaveEdgePath', 'edgeTtsPathInput', 'edgeTtsPath', 'Edge TTS Path Saved!')

  // Password Visibility
  bindToggle('btnToggleKey', 'apiKeyInput')
  bindToggle('btnToggleGenAiKey', 'genAiKeyInput')
  bindToggle('btnToggleElevenImgKey', 'elevenLabsImgKeyInput')

  setupPathSelectors()
}

function setupAiEngineListeners() {
  // 1. Toggle Groups (TTS and Image Providers)
  const groups = document.querySelectorAll('.toggle-switch-group')

  groups.forEach((group) => {
    const buttons = group.querySelectorAll('.toggle-option')

    buttons.forEach((btn) => {
      btn.addEventListener('click', async () => {
        // Visual Update
        buttons.forEach((b) => b.classList.remove('active'))
        btn.classList.add('active')

        // Logic Update
        const hiddenInput = group.nextElementSibling // The <input type="hidden"> below the div
        if (hiddenInput) {
          const value = btn.dataset.value
          hiddenInput.value = value

          // Save specific setting based on input ID
          if (hiddenInput.id === 'ttsProvider') {
            await window.api.saveSetting('ttsProvider', value)
            // Note: Generator module will listen to changes or read this value later
            // to update the voice list dynamically.
          }
          if (hiddenInput.id === 'imageProvider') {
            await window.api.saveSetting('imageProvider', value)
          }
        }
      })
    })
  })

  // 2. Model Selection
  const modelSelect = document.getElementById('modelSelect')
  if (modelSelect) {
    modelSelect.addEventListener('change', async (e) => {
      await window.api.saveSetting('lastModel', e.target.value)
    })
  }
}

function setupPathSelectors() {
  const bindSelect = (btnId, displayId, settingKey, type = 'file', filters = []) => {
    const btn = document.getElementById(btnId)
    if (btn) {
      btn.addEventListener('click', async () => {
        let path = null
        if (type === 'folder') path = await window.api.selectFolder()
        else path = await window.api.selectFile(filters)

        if (path) {
          document.getElementById(displayId).value = path
          await window.api.saveSetting(settingKey, path)
          showToast('Path Saved', 'success')
        }
      })
    }
  }

  bindSelect('btnSelectOutput', 'outputFolderDisplay', 'outputDir', 'folder')
  bindSelect('btnSelectFFmpeg', 'ffmpegPathDisplay', 'customFfmpegPath', 'file')
  bindSelect('btnSelectJson', 'promptFileDisplay', 'promptPath', 'file', ['json'])
  bindSelect('btnSelectSeoJson', 'seoPromptFileDisplay', 'seoPromptPath', 'file', ['json'])
}

// Helper to visually set the active toggle button
function updateToggleState(groupId, activeValue) {
  const group = document.getElementById(groupId)
  if (!group) return
  const buttons = group.querySelectorAll('.toggle-option')
  buttons.forEach((btn) => {
    if (btn.dataset.value === activeValue) {
      btn.classList.add('active')
    } else {
      btn.classList.remove('active')
    }
  })
}
