export function initTerminal() {
  const logsContainer = document.getElementById('logs-container')

  if (!logsContainer) {
    console.warn('Terminal container not found in DOM!')
    return
  }

  // 👇 ПЕРЕВІРКА: Шукаємо твій window.api (з preload.js)
  if (!window.api) {
    console.error('API not found! Preload script did not load correctly.')
    return
  }

  console.log('🖥️ Terminal module initialized')

  // Функція додавання рядка (залишається такою ж красивою)
  function addLogToTerminal(message) {
    // Ігноруємо порожні повідомлення
    if (!message) return

    const line = document.createElement('div')
    line.classList.add('log-line')

    // Логіка кольорів
    if (message.includes('✅') || message.includes('Successfully')) {
      line.classList.add('log-success')
      line.innerHTML = `<span style="color: #6e7681">[${new Date().toLocaleTimeString()}]</span> ${message}`
    } else if (message.includes('⚠️') || message.includes('Error') || message.includes('Failed')) {
      line.classList.add('log-error')
      line.innerHTML = `<span style="color: #f85149">✖</span> ${message}`
    } else if (
      message.includes('🎙️') ||
      message.includes('🎬') ||
      message.includes('🎨') ||
      message.includes('✍️')
    ) {
      line.classList.add('log-info')
      // Підсвічуємо ключові слова
      const formatted = message.replace(/(Whisper|FFmpeg|GenAI|Edge TTS|11Labs)/g, '<b>$1</b>')
      line.innerHTML = `<span style="color: #58a6ff">➜</span> ${formatted}`
    } else if (message.includes('⬇️')) {
      line.classList.add('log-warn')
      line.innerHTML = `${message}`
    } else {
      line.classList.add('text-muted')
      line.innerHTML = message
    }

    // Вставка перед курсором
    const cursor = logsContainer.querySelector('.cursor')
    if (cursor) {
      logsContainer.insertBefore(line, cursor.parentElement)
    } else {
      logsContainer.appendChild(line)
    }

    // Автоскрол вниз
    logsContainer.scrollTop = logsContainer.scrollHeight
  }

  // 👇 ГОЛОВНА ЗМІНА:
  // Ми використовуємо функцію onLogUpdate, яку ти створив у preload.js
  // замість ipc.on(...)
  window.api.onLogUpdate((message) => {
    addLogToTerminal(message)
  })
}
