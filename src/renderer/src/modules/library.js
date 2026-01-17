/**
 * Module: Library (MASTER VERSION)
 * Handles management of story prompts, SEO prompts, Image prompts in a SINGLE JSON file.
 */

import { showToast } from './ui.js'

// --- STATE ---
// Ми тримаємо дані в пам'яті окремо, але зберігаємо разом
let libraryData = {
  stories: {},
  seo: {},
  images: {}
}

let favoriteVoices = []
let currentLibraryPath = null // Шлях до єдиного файлу library.json

// Змінні для редагування
let currentEditingKey = null
let currentSeoEditingKey = null
let currentImageEditingKey = null

// --- INITIALIZATION ---
export async function initLibrary() {
  setupLibraryTabs()
  setupEditorActions() // Налаштування кнопок Save/Delete/New
  setupSettingsActions() // Налаштування вибору файлу в Settings
  setupFavoritesActions()

  // 1. Load Master Library Path from Settings
  const savedPath = await window.api.getSetting('masterLibraryPath')
  if (savedPath) {
    const input = document.getElementById('masterLibraryDisplay')
    if (input) input.value = savedPath
    await loadMasterLibrary(savedPath)
  }

  // 2. Load Favorites
  favoriteVoices = (await window.api.getSetting('favoriteVoices')) || []
  renderFavoritesList()
}

// --- CORE: LOAD & SAVE MASTER FILE ---

async function loadMasterLibrary(path) {
  try {
    const json = await window.api.readJson(path)
    if (json) {
      currentLibraryPath = path

      // Розподіляємо дані (або створюємо пусті об'єкти, якщо їх немає)
      libraryData.stories = json.stories || {}
      libraryData.seo = json.seo || {}
      libraryData.images = json.images || {}

      // Оновлюємо UI для всіх трьох категорій
      refreshAllLists()

      console.log('📚 Master Library Loaded:', path)
    }
  } catch (e) {
    console.error(e)
    showToast('Failed to load library file', 'error')
  }
}

async function saveMasterLibrary() {
  if (!currentLibraryPath) return showToast('No library file selected in Settings!', 'error')

  try {
    // Зберігаємо всю структуру цілком
    await window.api.writeJson(currentLibraryPath, libraryData)
    // Перезавантажуємо UI про всяк випадок
    refreshAllLists()
    showToast('Library Saved', 'success')
  } catch (e) {
    console.error(e)
    showToast('Failed to save library', 'error')
  }
}

function refreshAllLists() {
  // 1. Stories
  renderList('promptKeysList', libraryData.stories, (key) => {
    currentEditingKey = key
    document.getElementById('editorOverlay').classList.add('hidden')
    document.getElementById('editPromptKey').value = key
    document.getElementById('editPromptText').value = libraryData.stories[key]
  })
  renderGeneratorButtons(libraryData.stories, 'templates-container', 'selectedTemplate')

  // 2. SEO
  renderList('seoPromptKeysList', libraryData.seo, (key) => {
    currentSeoEditingKey = key
    document.getElementById('seoEditorOverlay').classList.add('hidden')
    document.getElementById('editSeoPromptKey').value = key
    document.getElementById('editSeoPromptText').value = libraryData.seo[key]
  })
  renderGeneratorButtons(libraryData.seo, 'seo-templates-container', 'selectedSeoTemplate')

  // 3. Images
  renderList('imagePromptKeysList', libraryData.images, (key) => {
    currentImageEditingKey = key
    document.getElementById('imageEditorOverlay').classList.add('hidden')
    document.getElementById('editImagePromptKey').value = key
    document.getElementById('editImagePromptText').value = libraryData.images[key]
  })
  renderGeneratorButtons(libraryData.images, 'image-templates-container', 'selectedImageTemplate')
}

// --- SETUP FUNCTIONS ---

function setupSettingsActions() {
  // Кнопка вибору файлу в налаштуваннях
  const btn = document.getElementById('btnSelectMasterLibrary')
  if (btn) {
    btn.addEventListener('click', async () => {
      const path = await window.api.selectFile(['json'])
      if (path) {
        await window.api.saveSetting('masterLibraryPath', path)
        document.getElementById('masterLibraryDisplay').value = path
        await loadMasterLibrary(path)
        showToast('Library Loaded Successfully', 'success')
      }
    })
  }
}

function setupEditorActions() {
  // === STORIES ===
  document.getElementById('btnNewPrompt')?.addEventListener('click', () => {
    prepareEditor('editPromptKey', 'editPromptText', 'editorOverlay', 'New_Story')
    currentEditingKey = null
  })

  document.getElementById('btnSavePrompt')?.addEventListener('click', async () => {
    const key = document.getElementById('editPromptKey').value.trim()
    const val = document.getElementById('editPromptText').value
    if (!key) return showToast('Key required', 'error')

    // Якщо ключ змінився, видаляємо старий
    if (currentEditingKey && currentEditingKey !== key)
      delete libraryData.stories[currentEditingKey]

    libraryData.stories[key] = val
    currentEditingKey = key
    await saveMasterLibrary()
  })

  document.getElementById('btnDeletePrompt')?.addEventListener('click', async () => {
    if (currentEditingKey && confirm(`Delete "${currentEditingKey}"?`)) {
      delete libraryData.stories[currentEditingKey]
      currentEditingKey = null
      document.getElementById('editorOverlay').classList.remove('hidden')
      await saveMasterLibrary()
    }
  })

  // === SEO ===
  document.getElementById('btnNewSeoPrompt')?.addEventListener('click', () => {
    prepareEditor('editSeoPromptKey', 'editSeoPromptText', 'seoEditorOverlay', 'New_SEO')
    currentSeoEditingKey = null
  })

  document.getElementById('btnSaveSeoPrompt')?.addEventListener('click', async () => {
    const key = document.getElementById('editSeoPromptKey').value.trim()
    const val = document.getElementById('editSeoPromptText').value
    if (!key) return showToast('Key required', 'error')

    if (currentSeoEditingKey && currentSeoEditingKey !== key)
      delete libraryData.seo[currentSeoEditingKey]

    libraryData.seo[key] = val
    currentSeoEditingKey = key
    await saveMasterLibrary()
  })

  document.getElementById('btnDeleteSeoPrompt')?.addEventListener('click', async () => {
    if (currentSeoEditingKey && confirm(`Delete "${currentSeoEditingKey}"?`)) {
      delete libraryData.seo[currentSeoEditingKey]
      currentSeoEditingKey = null
      document.getElementById('seoEditorOverlay').classList.remove('hidden')
      await saveMasterLibrary()
    }
  })

  // === IMAGES ===
  document.getElementById('btnNewImagePrompt')?.addEventListener('click', () => {
    prepareEditor('editImagePromptKey', 'editImagePromptText', 'imageEditorOverlay', 'New_Style')
    currentImageEditingKey = null
  })

  document.getElementById('btnSaveImagePrompt')?.addEventListener('click', async () => {
    const key = document.getElementById('editImagePromptKey').value.trim()
    const val = document.getElementById('editImagePromptText').value
    if (!key) return showToast('Key required', 'error')

    if (currentImageEditingKey && currentImageEditingKey !== key)
      delete libraryData.images[currentImageEditingKey]

    libraryData.images[key] = val
    currentImageEditingKey = key
    await saveMasterLibrary()
  })

  document.getElementById('btnDeleteImagePrompt')?.addEventListener('click', async () => {
    if (currentImageEditingKey && confirm(`Delete "${currentImageEditingKey}"?`)) {
      delete libraryData.images[currentImageEditingKey]
      currentImageEditingKey = null
      document.getElementById('imageEditorOverlay').classList.remove('hidden')
      await saveMasterLibrary()
    }
  })
}

function prepareEditor(keyId, textId, overlayId, defaultKey) {
  document.getElementById(overlayId).classList.add('hidden')
  document.getElementById(keyId).value = defaultKey
  document.getElementById(textId).value = ''
}

// --- STANDARD UI HELPERS ---

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

function renderGeneratorButtons(data, containerId, hiddenInputId) {
  const container = document.getElementById(containerId)
  if (!container) return
  container.innerHTML = ''

  const keys = Object.keys(data)
  if (keys.length === 0) {
    container.innerHTML = '<p class="empty-msg">No templates</p>'
    return
  }

  let iconClass = 'fa-solid fa-file-lines'
  if (containerId.includes('image')) iconClass = 'fa-solid fa-image'
  if (containerId.includes('seo')) iconClass = 'fa-solid fa-magnifying-glass'

  keys.forEach((key) => {
    const btn = document.createElement('button')
    btn.className = 'template-btn'
    btn.innerHTML = `<i class="${iconClass}"></i><span>${key}</span>`
    btn.addEventListener('click', () => {
      container.querySelectorAll('.template-btn').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
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

// --- FAVORITES (UNCHANGED) ---
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
      window.dispatchEvent(new Event('favorites-updated'))
    })
    list.appendChild(li)
  })
}

// --- EXPORTS ---
export function getFavorites() {
  return favoriteVoices
}
export function getPromptText(key) {
  return libraryData.stories[key] || ''
}
export function getSeoPromptText(key) {
  return libraryData.seo[key] || ''
}
export function getImagePromptText(key) {
  return libraryData.images[key] || ''
}
