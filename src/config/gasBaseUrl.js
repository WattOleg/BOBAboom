/**
 * Legacy helper kept for compatibility.
 * The current app uses Supabase and local storage, so production builds no longer need
 * any Apps Script proxy URL.
 */
export function getGasClientBaseUrl() {
  const raw = String(import.meta.env.VITE_APPS_SCRIPT_URL || '').trim()
  if (typeof window === 'undefined') return raw || ''

  const host = window.location.hostname
  const localHost = host === 'localhost' || host === '127.0.0.1'
  if (import.meta.env.DEV || localHost) return raw

  return ''
}
