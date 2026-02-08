/**
 * Main Renderer Entry Point
 * Orchestrates initialization of different application modules.
 */

import { setupUiInteractions } from './modules/ui.js'
import { initSettings } from './modules/settings.js'
import { initLibrary } from './modules/library.js'
import { initHistory } from './modules/history.js'
import { initGenerator } from './modules/generator.js'
import { initTerminal } from './modules/terminal.js'

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Renderer initialized')

  // 1. Initialize UI elements (Tabs, Accordion, etc.)
  setupUiInteractions()

  // 2. Initialize Settings (Load keys, paths, listeners)
  await initSettings()

  // 3. Initialize Library (Load prompts, favorites logic)
  await initLibrary()

  // 4. Initialize History (Load past projects
  await initHistory()

  // 5. Initialize Generator (Logic for creation flow)
  await initGenerator() // <--- Init Generator

  initTerminal()
})
