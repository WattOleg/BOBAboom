import { createClient } from '@supabase/supabase-js'

const URL = String(import.meta.env.VITE_SUPABASE_URL || '').trim()
const KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

export const isSupabaseConfigured = Boolean(URL && KEY)

let supabase = null
if (isSupabaseConfigured) {
  supabase = createClient(URL, KEY)
} else {
  // graceful fallback when env vars are missing (prevents runtime crash)
  // modules can check `isSupabaseConfigured` before calling real methods
  // provide minimal shims used by the app
  supabase = {
    auth: {
      getSession: async () => ({ data: { session: null } })
    },
    from: () => ({ select: async () => ({ data: [], error: null }) }),
    // generic fallback for other method access
    rpc: async () => ({ data: null, error: new Error('Supabase not configured') })
  }
}

export async function getSession() {
  if (!isSupabaseConfigured) return null
  try {
    const r = await supabase.auth.getSession()
    return r.data?.session ?? null
  } catch {
    return null
  }
}

export default supabase
