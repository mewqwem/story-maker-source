/**
 * Module: Library
 * Handles management of story prompts, SEO prompts, and favorite voices.
 */

import { showToast } from './ui.js'

// State
let promptsData = {}
let seoPromptsData = {}
let favoriteVoices = []
let currentPromptPath = null
let currentSeoPromptPath = null
let currentEditingKey = null
let currentSeoEditingKey = null

export async function initLibrary() {
  setupLibraryTabs()
  setupPromptActions()
  setupSeoActions()
  setupFavoritesActions()

  // Initial Load from Settings
  const savedPromptPath = await window.api.getSetting('promptPath')
  if (savedPromptPath) await loadPromptsFromFile(savedPromptPath)

  const savedSeoPath = await window.api.getSetting('seoPromptPath')
  if (savedSeoPath) await loadSeoPromptsFromFile(savedSeoPath)

  favoriteVoices = (await window.api.getSetting('favoriteVoices')) || []
  renderFavoritesList()
}

function setupLibraryTabs() {
  const tabBtns = document.querySelectorAll('.lib-tab-btn')
  const panels = document.querySelectorAll('.lib-panel')

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'))
      panels.forEach((p) => p.classList.remove('active'))
      btn.classList.add('active')
      const targetPanel = document.getElementById(btn.dataset.libTarget)
      if (targetPanel) targetPanel.classList.add('active')
    })
  })
}

// --- Story Prompts ---
async function loadPromptsFromFile(path) {
  try {
    const json = await window.api.readJson(path)
    if (json) {
      promptsData = json
      currentPromptPath = path

      // 1. Render List in Library Tab
      renderList('promptKeysList', json, (key) => {
        currentEditingKey = key
        document.getElementById('editorOverlay').classList.add('hidden')
        document.getElementById('editPromptKey').value = key
        document.getElementById('editPromptText').value = promptsData[key]
      })

      // 2. Render Buttons in Generator Tab (FIXED)
      renderGeneratorButtons(json, 'templates-container', 'selectedTemplate')
    }
  } catch (e) {
    console.error(e)
    showToast('Failed to load prompts', 'error')
  }
}

function setupPromptActions() {
  const btnLoad = document.getElementById('btnSelectJsonLibrary')
  if (btnLoad) {
    btnLoad.addEventListener('click', async () => {
      const path = await window.api.selectFile(['json'])
      if (path) {
        await window.api.saveSetting('promptPath', path)
        document.getElementById('promptFileDisplay').value = path
        await loadPromptsFromFile(path)
        showToast('Story Prompts Loaded', 'success')
      }
    })
  }

  // New, Save, Delete logic...
  document.getElementById('btnNewPrompt')?.addEventListener('click', () => {
    document.getElementById('editorOverlay').classList.add('hidden')
    document.getElementById('editPromptKey').value = 'New_Key'
    document.getElementById('editPromptText').value = ''
    currentEditingKey = null
  })

  document.getElementById('btnSavePrompt')?.addEventListener('click', async () => {
    if (!currentPromptPath) return showToast('No file loaded!', 'error')
    const newKey = document.getElementById('editPromptKey').value.trim()
    const newText = document.getElementById('editPromptText').value
    if (!newKey) return showToast('Key required', 'error')

    if (currentEditingKey && currentEditingKey !== newKey) delete promptsData[currentEditingKey]
    promptsData[newKey] = newText
    currentEditingKey = newKey

    await window.api.writeJson(currentPromptPath, promptsData)
    await loadPromptsFromFile(currentPromptPath)
    showToast('Saved', 'success')
  })

  document.getElementById('btnDeletePrompt')?.addEventListener('click', async () => {
    if (!currentEditingKey) return
    if (confirm(`Delete "${currentEditingKey}"?`)) {
      delete promptsData[currentEditingKey]
      await window.api.writeJson(currentPromptPath, promptsData)
      currentEditingKey = null
      document.getElementById('editorOverlay').classList.remove('hidden')
      await loadPromptsFromFile(currentPromptPath)
      showToast('Deleted', 'info')
    }
  })
}

// --- SEO Prompts ---
async function loadSeoPromptsFromFile(path) {
  try {
    const json = await window.api.readJson(path)
    if (json) {
      seoPromptsData = json
      currentSeoPromptPath = path

      // 1. Render Library List
      renderList('seoPromptKeysList', json, (key) => {
        currentSeoEditingKey = key
        document.getElementById('seoEditorOverlay').classList.add('hidden')
        document.getElementById('editSeoPromptKey').value = key
        document.getElementById('editSeoPromptText').value = seoPromptsData[key]
      })

      // 2. Render Generator Buttons (FIXED)
      renderGeneratorButtons(json, 'seo-templates-container', 'selectedSeoTemplate')
    }
  } catch (e) {
    console.error(e)
  }
}

function setupSeoActions() {
  document.getElementById('btnSelectSeoJsonLibrary')?.addEventListener('click', async () => {
    const path = await window.api.selectFile(['json'])
    if (path) {
      await window.api.saveSetting('seoPromptPath', path)
      document.getElementById('seoPromptFileDisplay').value = path
      await loadSeoPromptsFromFile(path)
      showToast('SEO Prompts Loaded', 'success')
    }
  })

  // Save/Delete SEO Logic...
  document.getElementById('btnNewSeoPrompt')?.addEventListener('click', () => {
    document.getElementById('seoEditorOverlay').classList.add('hidden')
    document.getElementById('editSeoPromptKey').value = 'New_SEO_Key'
    document.getElementById('editSeoPromptText').value = ''
    currentSeoEditingKey = null
  })

  document.getElementById('btnSaveSeoPrompt')?.addEventListener('click', async () => {
    if (!currentSeoPromptPath) return showToast('No SEO file!', 'error')
    const key = document.getElementById('editSeoPromptKey').value.trim()
    const text = document.getElementById('editSeoPromptText').value
    if (!key) return showToast('Key required', 'error')

    if (currentSeoEditingKey && currentSeoEditingKey !== key)
      delete seoPromptsData[currentSeoEditingKey]
    seoPromptsData[key] = text
    currentSeoEditingKey = key

    await window.api.writeJson(currentSeoPromptPath, seoPromptsData)
    await loadSeoPromptsFromFile(currentSeoPromptPath)
    showToast('Saved', 'success')
  })

  document.getElementById('btnDeleteSeoPrompt')?.addEventListener('click', async () => {
    if (!currentSeoEditingKey) return
    if (confirm(`Delete "${currentSeoEditingKey}"?`)) {
      delete seoPromptsData[currentSeoEditingKey]
      await window.api.writeJson(currentSeoPromptPath, seoPromptsData)
      currentSeoEditingKey = null
      document.getElementById('seoEditorOverlay').classList.remove('hidden')
      await loadSeoPromptsFromFile(currentSeoPromptPath)
      showToast('Deleted', 'info')
    }
  })
}

// --- Favorites ---
function setupFavoritesActions() {
  document.getElementById('btnAddFavorite')?.addEventListener('click', async () => {
    const name = document.getElementById('favVoiceName').value.trim()
    const id = document.getElementById('favVoiceIdInput').value.trim()
    const lang = document.getElementById('favVoiceLang').value
    if (!name || !id) return showToast('Info missing', 'error')

    favoriteVoices.push({ name, voice_id: id, language: lang })
    await window.api.saveSetting('favoriteVoices', favoriteVoices)

    renderFavoritesList()
    showToast('Favorite Added', 'success')

    // SIGNAL GENERATOR TO UPDATE
    window.dispatchEvent(new Event('favorites-updated'))

    document.getElementById('favVoiceName').value = ''
    document.getElementById('favVoiceIdInput').value = ''
  })
}

function renderFavoritesList() {
  const list = document.getElementById('favoritesList')
  if (!list) return
  list.innerHTML = favoriteVoices.length
    ? ''
    : '<li style="color:#555;text-align:center;">No favorites</li>'

  favoriteVoices.forEach((v) => {
    const li = document.createElement('li')
    li.innerHTML = `
      <div class="fav-chip">
         <div style="display:flex; flex-direction:column;">
            <strong>${v.name}</strong>
            <small style="color:#666; font-size:10px;">${v.language.toUpperCase()}</small>
         </div>
         <button class="btn-remove-fav"><i class="fa-solid fa-xmark"></i></button>
      </div>`

    li.querySelector('.btn-remove-fav').addEventListener('click', async (e) => {
      e.stopPropagation()
      favoriteVoices = favoriteVoices.filter((fv) => fv.voice_id !== v.voice_id)
      await window.api.saveSetting('favoriteVoices', favoriteVoices)
      renderFavoritesList()
      // SIGNAL GENERATOR TO UPDATE
      window.dispatchEvent(new Event('favorites-updated'))
    })
    list.appendChild(li)
  })
}

// --- Helpers ---
function renderList(listId, data, cb) {
  const list = document.getElementById(listId)
  if (!list) return
  list.innerHTML = ''
  Object.keys(data).forEach((key) => {
    const li = document.createElement('li')
    li.className = 'prompt-key-item'
    li.innerText = key
    li.addEventListener('click', () => {
      list.querySelectorAll('.prompt-key-item').forEach((i) => i.classList.remove('active'))
      li.classList.add('active')
      cb(key)
    })
    list.appendChild(li)
  })
}

// NEW FUNCTION: Render buttons in Generator Tab
function renderGeneratorButtons(data, containerId, hiddenInputId) {
  const container = document.getElementById(containerId)
  if (!container) return

  container.innerHTML = ''
  const keys = Object.keys(data)

  if (keys.length === 0) {
    container.innerHTML = '<p class="empty-msg">Empty file</p>'
    return
  }

  keys.forEach((key) => {
    const btn = document.createElement('button')
    btn.className = 'template-btn'
    btn.innerHTML = `<i class="fa-solid fa-file-lines"></i><span>${key}</span>`

    btn.addEventListener('click', () => {
      // Remove active class from siblings
      container.querySelectorAll('.template-btn').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      // Set value to hidden input
      const hidden = document.getElementById(hiddenInputId)
      if (hidden) hidden.value = key
    })

    container.appendChild(btn)
  })

  // Auto-select first
  if (container.children.length > 0) {
    container.children[0].click()
  }
}

// --- EXPORTS ---
export function getFavorites() {
  return favoriteVoices
}

export function getPromptText(key) {
  return promptsData[key] || ''
}

export function getSeoPromptText(key) {
  return seoPromptsData[key] || ''
}
