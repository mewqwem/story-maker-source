// src/main/services/storeService.js
const Store = require('electron-store') // Використовуємо старий добрий require для надійності

const store = new Store()

export function getSetting(key) {
  return store.get(key)
}

export function saveSetting(key, value) {
  store.set(key, value)
  return true
}

export function getAllSettings() {
  return store.store
}
