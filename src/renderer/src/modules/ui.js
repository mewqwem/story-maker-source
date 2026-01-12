/**
 * Module: UI
 * Handles general UI interactions like navigation, accordions, and toasts.
 */

export function setupUiInteractions() {
  setupNavigation()
  setupAccordion()
}

function setupNavigation() {
  const navBtns = document.querySelectorAll('.nav-item')
  const pages = document.querySelectorAll('.view')

  navBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      navBtns.forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      const targetId = btn.dataset.target
      pages.forEach((p) => {
        p.classList.toggle('active', p.id === targetId)
      })
    })
  })
}

function setupAccordion() {
  const triggers = document.querySelectorAll('.accordion-trigger')
  triggers.forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const content = trigger.nextElementSibling
      const isOpen = content.style.maxHeight !== '0px' && content.style.maxHeight !== ''

      if (isOpen) {
        content.style.maxHeight = '0px'
        content.style.opacity = '0'
        content.style.padding = '0 15px'
        trigger.classList.remove('active')
      } else {
        content.style.maxHeight = content.scrollHeight + 50 + 'px'
        content.style.opacity = '1'
        content.style.padding = '15px'
        trigger.classList.add('active')
      }
    })
  })
}

/**
 * Displays a non-blocking toast notification.
 * @param {string} msg - Message to display
 * @param {string} type - 'info', 'success', 'error'
 */
export function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container')
  if (!container) return

  const toast = document.createElement('div')
  toast.className = 'toast'

  let icon = '<i class="fa-solid fa-info-circle"></i>'
  if (type === 'success') icon = '<i class="fa-solid fa-check-circle"></i>'
  if (type === 'error') icon = '<i class="fa-solid fa-triangle-exclamation"></i>'

  toast.innerHTML = `${icon} <span>${msg}</span>`
  container.appendChild(toast)

  setTimeout(() => {
    toast.style.opacity = '0'
    setTimeout(() => toast.remove(), 300)
  }, 4000)
}
