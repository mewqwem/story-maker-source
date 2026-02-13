import { defineConfig } from 'electron-vite'
import injectHTML from 'vite-plugin-html-inject'

export default defineConfig({
  main: {},
  preload: {},
  renderer: { plugins: [injectHTML()] }
})
