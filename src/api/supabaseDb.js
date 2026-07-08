const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

async function postToSupabase(path, options = {}) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase not configured')
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  })

  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }

  if (!response.ok) {
    const message = data?.message || data?.error || `Supabase request failed (${response.status})`
    throw new Error(message)
  }

  return data
}

async function readAppDataRecord(key, signal) {
  const rows = await postToSupabase(`app_data?select=id,key,value,updated_at&order=updated_at.desc`, { signal })
  if (!Array.isArray(rows)) return null
  return rows.find((row) => row?.key === key) || null
}

export async function readAppData(key, fallback, options = {}) {
  if (!isSupabaseConfigured) return fallback
  try {
    const row = await readAppDataRecord(key, options.signal)
    if (!row) return fallback
    return row.value ?? fallback
  } catch {
    return fallback
  }
}

export async function writeAppData(key, value, options = {}) {
  if (!isSupabaseConfigured) return value
  try {
    const existing = await readAppDataRecord(key, options.signal)
    const payload = {
      key,
      value,
      updated_at: new Date().toISOString(),
    }

    if (existing?.id) {
      await postToSupabase(`app_data?id=eq.${existing.id}`, {
        method: 'PATCH',
        body: payload,
        signal: options.signal,
      })
    } else {
      await postToSupabase('app_data', {
        method: 'POST',
        body: payload,
        signal: options.signal,
      })
    }
    return value
  } catch {
    return value
  }
}

export async function readTechcardsFromSupabase(options = {}) {
  const payload = await readAppData('techcards', [], options)
  return Array.isArray(payload) ? payload : []
}

export async function writeTechcardsToSupabase(cards, options = {}) {
  return writeAppData('techcards', cards, options)
}

export async function readSectionsFromSupabase(options = {}) {
  const payload = await readAppData('sections', {}, options)
  return payload && typeof payload === 'object' ? payload : {}
}

export async function writeSectionsToSupabase(sections, options = {}) {
  return writeAppData('sections', sections, options)
}

export async function readScheduleFromSupabase(options = {}) {
  const payload = await readAppData('schedule', null, options)
  return payload && typeof payload === 'object' ? payload : null
}

export async function writeScheduleToSupabase(schedule, options = {}) {
  return writeAppData('schedule', schedule, options)
}

export async function readWriteoffsFromSupabase(options = {}) {
  const payload = await readAppData('writeoffs', { entries: [], templates: [] }, options)
  return payload && typeof payload === 'object' ? payload : { entries: [], templates: [] }
}

export async function writeWriteoffsToSupabase(writeoffs, options = {}) {
  return writeAppData('writeoffs', writeoffs, options)
}

export async function readStopListFromSupabase(options = {}) {
  const payload = await readAppData('stop_list', [], options)
  return Array.isArray(payload) ? payload : []
}

export async function writeStopListToSupabase(stopList, options = {}) {
  return writeAppData('stop_list', stopList, options)
}
