import { contextBridge, ipcRenderer } from 'electron'

// Custom APIs for renderer
const api = {
  // Settings & Config
  getSetting: (key) => ipcRenderer.invoke('get-setting', key),
  saveSetting: (key, value) => ipcRenderer.invoke('save-setting', key, value),

  // File System
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFile: (extensions) => ipcRenderer.invoke('select-file', extensions),
  readJson: (path) => ipcRenderer.invoke('read-json', path),
  writeJson: (path, data) => ipcRenderer.invoke('write-json', path, data),
  openFolder: (path) => ipcRenderer.invoke('open-folder', path),

  // History
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),

  // Generation Logic
  generateStoryText: (data) => ipcRenderer.invoke('generate-story-text', data),
  generateAudioOnly: (data) => ipcRenderer.invoke('generate-audio-only', data),
  generateAudioPart: (data) => ipcRenderer.invoke('generate-audio-part', data),
  generateImagesPart: (data) => ipcRenderer.invoke('generate-images-part', data),
  renderVideoPart: (data) => ipcRenderer.invoke('render-video-part', data),

  onLogUpdate: (callback) => ipcRenderer.on('log-update', (_event, value) => callback(value)),

  // Utils
  getVersion: () => ipcRenderer.invoke('get-version')
}

// Use `contextBridge` APIs to expose IPC to renderer
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.api = api
}
