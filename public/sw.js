const STATIC_CACHE = 'tk-static-v4'
const RUNTIME_CACHE = 'tk-runtime-v4'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/e-Bar.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }
  // Apps Script нельзя гонять через SW: иначе на iOS «Failed to fetch» / пустой ответ из-за
  // Promise, резолвящегося в null, и кэша чужого origin.
  if (url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com') {
    return
  }
  if (request.method !== 'GET') return
  const isImageRequest = request.destination === 'image'

  // Avoid stale/broken cached remote images (especially Drive links).
  // Always try network first for images; fall back to cache when offline.
  if (isImageRequest) {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(request)
        return cached || Response.error()
      }),
    )
    return
  }
  const isAppShellRequest = request.mode === 'navigate'
  if (isAppShellRequest) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(STATIC_CACHE).then((cache) => cache.put('/index.html', copy))
          return res
        })
        .catch(async () => {
          const cached = await caches.match('/index.html')
          return cached || Response.error()
        }),
    )
    return
  }

  // API on same-origin should be network-only (fresh data, no stale cache).
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => Response.error()))
    return
  }

  // Cache-first for same-origin static resources.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const copy = res.clone()
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy))
            return res
          }),
      ),
    )
    return
  }

  // Stale-while-revalidate for API/remote GETs.
  event.respondWith(
    caches.match(request).then(async (cached) => {
      const networkPromise = fetch(request)
        .then((res) => {
          if (res && res.ok && res.status === 200) {
            const copy = res.clone()
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy).catch(() => {}))
          }
          return res
        })
        .catch(() => Response.error())

      if (cached) return cached
      return networkPromise
    }),
  )
})
