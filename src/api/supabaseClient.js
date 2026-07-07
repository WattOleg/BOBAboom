import { createClient } from '@supabase/supabase-js'

const URL = String(import.meta.env.VITE_SUPABASE_URL || '').trim()
const KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

export const supabase = createClient(URL, KEY)

export async function getSession() {
  try {
    const r = await supabase.auth.getSession()
    return r.data?.session ?? null
  } catch {
    return null
  }
}

export default supabase
