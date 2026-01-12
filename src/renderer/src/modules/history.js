/**
 * Module: History
 * Handles loading, rendering, and management of project generation history.
 */

import { showToast } from './ui.js'

export async function initHistory() {
  await loadHistory()
  setupHistoryActions()
}

/**
 * Fetches history from the main process and renders it.
 */
export async function loadHistory() {
  try {
    const history = await window.api.getHistory()
    renderHistoryList(history)
  } catch (error) {
    console.error('Failed to load history:', error)
  }
}

/**
 * Renders the history items into the DOM.
 * @param {Array} historyItems - List of history objects
 */
function renderHistoryList(historyItems) {
  const list = document.getElementById('historyList')
  if (!list) return

  list.innerHTML = ''

  if (historyItems.length === 0) {
    list.innerHTML =
      '<div style="color:#666; text-align:center; padding:20px;">No history yet</div>'
    return
  }

  historyItems.forEach((item) => {
    const div = document.createElement('div')
    div.className = 'history-item'

    // Formatting the date nicely if needed, otherwise use raw string
    div.innerHTML = `
        <strong>${item.title || 'Untitled'}</strong>
        <small>${item.date}</small>
        <small style="color:#444;">${item.projectName}</small>
    `

    // Click listener to open the project folder
    div.addEventListener('click', async () => {
      await window.api.openFolder(item.path)
    })

    list.appendChild(div)
  })
}

/**
 * Sets up event listeners for history actions (Clear, Refresh if needed).
 */
function setupHistoryActions() {
  const btnClear = document.getElementById('btnClearHistory')

  if (btnClear) {
    btnClear.addEventListener('click', async () => {
      if (confirm('Are you sure you want to delete all history logs? This cannot be undone.')) {
        await window.api.clearHistory()
        renderHistoryList([]) // Clear UI immediately
        showToast('History cleared!', 'success')
      }
    })
  }

  // Optional: Reload history when switching to the history tab
  // We attach this to the tab button itself
  const historyTabBtn = document.querySelector('[data-target="page-history"]')
  if (historyTabBtn) {
    historyTabBtn.addEventListener('click', () => {
      loadHistory()
    })
  }
}
