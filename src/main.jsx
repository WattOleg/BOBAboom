import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const VISIT_EVENT = 'app-visit-count'
const LS_KEY = 'tk_app_visit_count'

// Global error overlay to surface runtime exceptions (helps diagnose white screen)
function showErrorOverlay(title, details) {
  try {
    let el = document.getElementById('bb-error-overlay')
    if (!el) {
      el = document.createElement('div')
      el.id = 'bb-error-overlay'
      el.style.position = 'fixed'
      el.style.inset = '0'
      el.style.background = 'rgba(0,0,0,0.7)'
      el.style.color = '#fff'
      el.style.zIndex = 99999
      el.style.padding = '24px'
      el.style.overflow = 'auto'
      document.body.appendChild(el)
    }
    el.innerHTML = `<h2 style="margin-top:0">${String(title)}</h2><pre style="white-space:pre-wrap">${String(
      details
    )}</pre>`
  } catch (e) {
    // ignore
  }
}

window.addEventListener('error', (ev) => {
  showErrorOverlay('Runtime error', `${ev.message}\n${ev.error ? ev.error.stack : ''}`)
})
window.addEventListener('unhandledrejection', (ev) => {
  showErrorOverlay('Unhandled promise rejection', ev.reason && ev.reason.stack ? ev.reason.stack : String(ev.reason))
})

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // ignore sw registration errors
    })
  })
}

;(async () => {
  try {
    const n = (parseInt(localStorage.getItem(LS_KEY) || '0', 10) || 0) + 1
    localStorage.setItem(LS_KEY, String(n))
    window.dispatchEvent(new CustomEvent(VISIT_EVENT, { detail: n }))
  } catch {
    /* без счётчика, если локальное хранилище недоступно */
  }
})()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
