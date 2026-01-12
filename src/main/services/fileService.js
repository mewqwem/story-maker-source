import { dialog } from 'electron'
import fs from 'fs-extra'

// Вибір папки
export async function selectFolder() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })
  if (canceled) return null
  return filePaths[0]
}

// Вибір файлу (можна передати розширення, наприклад ['json'])
export async function selectFile(extensions = []) {
  // На Mac OS краще показувати 'All Files', якщо це бінарник без розширення
  const filters =
    extensions.length > 0
      ? [{ name: 'Files', extensions }]
      : [{ name: 'All Files', extensions: ['*'] }]

  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters
  })
  if (canceled) return null
  return filePaths[0]
}

// Читання JSON
export async function readJson(path) {
  try {
    return await fs.readJson(path)
  } catch (err) {
    console.error('Read JSON Error:', err)
    return null
  }
}

// Запис JSON
export async function writeJson(path, data) {
  try {
    await fs.writeJson(path, data, { spaces: 2 })
    return true
  } catch (err) {
    console.error('Write JSON Error:', err)
    return false
  }
}
