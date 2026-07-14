import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || '').trim()
const SUPABASE_ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : {
      auth: {
        async getSession() {
          return { data: { session: null }, error: null }
        },
        async signInWithPassword() {
          return { data: { user: null, session: null }, error: { message: 'Supabase не настроен' } }
        },
        async signUp() {
          return { data: { user: null, session: null }, error: { message: 'Supabase не настроен' } }
        },
        async signOut() {
          return { error: null }
        },
        async resetPasswordForEmail() {
          return { data: {}, error: { message: 'Supabase не настроен' } }
        },
        async updateUser() {
          return { data: { user: null }, error: { message: 'Supabase не настроен' } }
        },
        onAuthStateChange(callback) {
          callback('INITIAL_SESSION', null)
          return {
            data: {
              subscription: {
                unsubscribe() {},
              },
            },
          }
        },
      },
      storage: {
        from() {
          return {
            async upload() {
              return { data: null, error: new Error('Supabase Storage не настроен') }
            },
            getPublicUrl() {
              return { data: { publicUrl: '' } }
            },
          }
        },
      },
    }

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

  return `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(bucket)}/${storagePath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`
}

export async function initAuth() {
  if (!isSupabaseConfigured) return
  // detectSessionInUrl handles recovery/magic-link tokens automatically
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
