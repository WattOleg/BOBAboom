import { createClient } from '@supabase/supabase-js'

const URL = String(import.meta.env.VITE_SUPABASE_URL || '').trim()
const KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

export const isSupabaseConfigured = Boolean(URL && KEY)

const LOCAL_AUTH_USERS_KEY = 'bb_local_auth_users_v1'
const LOCAL_AUTH_SESSION_KEY = 'bb_local_auth_session_v1'

function getStorage() {
  if (typeof window === 'undefined') return null
  return window.localStorage
}

function readJson(key) {
  const storage = getStorage()
  if (!storage) return null
  const raw = storage.getItem(key)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function writeJson(key, value) {
  const storage = getStorage()
  if (!storage) return
  storage.setItem(key, JSON.stringify(value))
}

function removeKey(key) {
  const storage = getStorage()
  if (!storage) return
  storage.removeItem(key)
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

async function hashPassword(value) {
  const input = String(value || '')
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const bytes = new TextEncoder().encode(input)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  return input
}

function createLocalSession(user) {
  return {
    access_token: `local-${user.id}`,
    refresh_token: `local-${user.id}`,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: {
      id: user.id,
      email: user.email,
      phone: null,
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {},
      user_metadata: {},
    },
  }
}

function createLocalUserId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function readLocalUsers() {
  const data = readJson(LOCAL_AUTH_USERS_KEY)
  return Array.isArray(data) ? data : []
}

function writeLocalUsers(users) {
  writeJson(LOCAL_AUTH_USERS_KEY, users)
}

function readLocalSession() {
  return readJson(LOCAL_AUTH_SESSION_KEY)
}

function writeLocalSession(session) {
  writeJson(LOCAL_AUTH_SESSION_KEY, session)
}

function clearLocalSession() {
  removeKey(LOCAL_AUTH_SESSION_KEY)
}

function createLocalAuth() {
  const listeners = new Set()

  const emit = (event, session) => {
    for (const listener of listeners) {
      listener(event, session)
    }
  }

  return {
    async getSession() {
      return { data: { session: readLocalSession() } }
    },
    async getSessionFromUrl() {
      return { data: { session: readLocalSession() } }
    },
    async signInWithPassword({ email, password }) {
      const normalizedEmail = normalizeEmail(email)
      const passwordHash = await hashPassword(password)
      const users = readLocalUsers()
      const existingUser = users.find((user) => user.email === normalizedEmail && user.passwordHash === passwordHash)

      if (!existingUser) {
        return {
          data: { user: null, session: null },
          error: { message: 'Invalid login credentials' },
        }
      }

      const session = createLocalSession(existingUser)
      writeLocalSession(session)
      emit('SIGNED_IN', session)
      return { data: { user: session.user, session }, error: null }
    },
    async signUp({ email, password }) {
      const normalizedEmail = normalizeEmail(email)
      if (!normalizedEmail || !password || String(password).length < 6) {
        return {
          data: { user: null, session: null },
          error: { message: 'Пароль должен быть не менее 6 символов' },
        }
      }

      const users = readLocalUsers()
      if (users.some((user) => user.email === normalizedEmail)) {
        return {
          data: { user: null, session: null },
          error: { message: 'Пользователь уже существует' },
        }
      }

      const passwordHash = await hashPassword(password)
      const user = {
        id: createLocalUserId(),
        email: normalizedEmail,
        passwordHash,
        createdAt: new Date().toISOString(),
      }
      users.push(user)
      writeLocalUsers(users)

      const session = createLocalSession(user)
      writeLocalSession(session)
      emit('SIGNED_IN', session)
      return { data: { user: session.user, session }, error: null }
    },
    async signOut() {
      clearLocalSession()
      emit('SIGNED_OUT', null)
      return { error: null }
    },
    onAuthStateChange(callback) {
      listeners.add(callback)
      return {
        data: {
          subscription: {
            unsubscribe: () => listeners.delete(callback),
          },
        },
      }
    },
  }
}

function createFallbackSupabaseClient() {
  const localAuth = createLocalAuth()
  const fallbackClient = {
    auth: localAuth,
    from: () => ({
      select: async () => ({ data: [], error: null }),
      insert: async () => ({ data: [], error: null }),
      update: async () => ({ data: [], error: null }),
      delete: async () => ({ data: [], error: null }),
    }),
    rpc: async () => ({ data: null, error: new Error('Supabase not configured') }),
  }

  return fallbackClient
}

function isAuthRedirectUrl() {
  if (typeof window === 'undefined') return false
  const url = new URL(window.location.href)
  return (
    window.location.hash.includes('access_token') ||
    window.location.hash.includes('refresh_token') ||
    url.searchParams.has('access_token') ||
    url.searchParams.has('refresh_token') ||
    url.searchParams.has('error_description')
  )
}

const remoteClient = isSupabaseConfigured ? createClient(URL, KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
}) : null

const localFallbackClient = createFallbackSupabaseClient()

function buildSupabaseClient() {
  if (!remoteClient) {
    return localFallbackClient
  }

  const localAuth = localFallbackClient.auth

  return {
    auth: {
      ...remoteClient.auth,
      async getSession() {
        try {
          const result = await remoteClient.auth.getSession()
          if (result?.data?.session) return result
        } catch {
          // fall through to local session
        }
        return localAuth.getSession()
      },
      async getSessionFromUrl(options) {
        try {
          const result = await remoteClient.auth.getSessionFromUrl(options)
          if (result?.data?.session) return result
        } catch {
          // fall through to local session
        }
        return localAuth.getSessionFromUrl()
      },
      async signInWithPassword(params) {
        try {
          const result = await remoteClient.auth.signInWithPassword(params)
          if (result?.error || !result?.data?.session?.user) {
            return localAuth.signInWithPassword(params)
          }
          return result
        } catch (error) {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('Supabase auth failed, using local fallback', error)
          }
          return localAuth.signInWithPassword(params)
        }
      },
      async signUp(params) {
        try {
          const result = await remoteClient.auth.signUp(params)
          if (result?.error || !result?.data?.user) {
            return localAuth.signUp(params)
          }
          return result
        } catch (error) {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('Supabase sign-up failed, using local fallback', error)
          }
          return localAuth.signUp(params)
        }
      },
      async signOut() {
        try {
          return await remoteClient.auth.signOut()
        } catch {
          return localAuth.signOut()
        }
      },
      onAuthStateChange(callback) {
        return remoteClient.auth.onAuthStateChange(callback)
      },
    },
    from: (table) => remoteClient.from(table),
    rpc: (fn, params) => remoteClient.rpc(fn, params),
    storage: remoteClient.storage || localFallbackClient.storage,
  }
}

const supabase = buildSupabaseClient()

function hashStorageLabel(value) {
  return [...String(value || '')].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0).toString(36)
}

function sanitizeStorageSegment(segment) {
  const raw = String(segment || '').trim()
  if (!raw) return 'misc'

  const ascii = raw
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (ascii.length >= 2) return ascii.slice(0, 120)

  return `item-${hashStorageLabel(raw)}`
}

function buildStorageFolder(options = {}) {
  if (options.sheetName) {
    const sheetName = String(options.sheetName).trim()
    if (!sheetName) return 'techcards/misc'
    return `techcards/${sanitizeStorageSegment(sheetName)}`
  }

  const folder = String(options.folder || 'techcards').replace(/^\/+|\/+$/g, '')
  if (!folder) return 'techcards'

  return folder
    .split('/')
    .filter(Boolean)
    .map(sanitizeStorageSegment)
    .join('/')
}

export async function uploadCardPhoto(file, options = {}) {
  if (!file) {
    throw new Error('Выберите файл изображения')
  }

  if (!isSupabaseConfigured) {
    throw new Error('Supabase Storage не настроен')
  }

  const bucket = String(options.bucket || import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || 'techcards').trim() || 'techcards'
  const folder = buildStorageFolder(options)
  const extension = String(file.name || '').split('.').pop()?.trim().toLowerCase()
  const safeExtension = extension && /^[a-z0-9]+$/.test(extension) ? `.${extension}` : '.jpg'
  const fileName =
    options.fileName ||
    `${Date.now()}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}${safeExtension}`
  const storagePath = `${folder}/${fileName}`

  const { error } = await supabase.storage.from(bucket).upload(storagePath, file, {
    cacheControl: '3600',
    upsert: false,
  })

  if (error) {
    throw new Error(error.message || 'Не удалось загрузить фото в Supabase Storage')
  }

  const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(storagePath)
  if (publicData?.publicUrl) {
    return publicData.publicUrl
  }

  return `${URL}/storage/v1/object/public/${encodeURIComponent(bucket)}/${storagePath.split('/').map(encodeURIComponent).join('/')}`
}

export async function initAuth() {
  if (!isSupabaseConfigured || !isAuthRedirectUrl()) return
  try {
    await supabase.auth.getSessionFromUrl({ storeSession: true })
    window.history.replaceState(null, '', window.location.pathname)
  } catch {
    // ignore parsing errors; session may still be available through regular getSession
  }
}

export async function getSession() {
  try {
    const result = await supabase.auth.getSession()
    return result?.data?.session ?? null
  } catch {
    return null
  }
}

export default supabase
