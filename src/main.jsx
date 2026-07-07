import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const VISIT_EVENT = 'app-visit-count'
const LS_KEY = 'tk_app_visit_count'

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
