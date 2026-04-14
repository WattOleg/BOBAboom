/**
 * База URL для запросов к Apps Script из браузера.
 *
 * Прямой fetch на https://script.google.com/... с другого домена (Vercel) блокируется CORS.
 * На сервере Vercel функция api/gas.js проксирует на APPS_SCRIPT_URL.
 *
 * Если в билде всё ещё полный URL Google (старая настройка), в production на публичном хосте
 * автоматически используем /api/gas — достаточно задать только APPS_SCRIPT_URL в Vercel.
 */
export function getGasClientBaseUrl() {
  const raw = String(import.meta.env.VITE_APPS_SCRIPT_URL || '').trim()
  if (typeof window === 'undefined') return raw || ''

  const host = window.location.hostname
  const localHost = host === 'localhost' || host === '127.0.0.1'
  if (!raw) {
    // На проде по умолчанию используем serverless-прокси, даже если забыли VITE_APPS_SCRIPT_URL.
    return import.meta.env.DEV || localHost ? '' : '/api/gas'
  }
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw
  if (import.meta.env.DEV || localHost) return raw

  if (/^https:\/\/script\.google\.com\//i.test(raw)) return '/api/gas'

  return raw
}
