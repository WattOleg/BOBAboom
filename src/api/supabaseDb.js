const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

/** Bootstrap admins (always admin). Добавляйте email через VITE_ADMIN_EMAILS на Vercel. */
const BOOTSTRAP_ADMIN_EMAILS = ['umaev1998@mail.ru']

const ADMIN_EMAILS = [
  ...BOOTSTRAP_ADMIN_EMAILS,
  ...String(import.meta.env.VITE_ADMIN_EMAILS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
]

const PROFILE_COLUMNS = 'id,email,full_name,role,created_at,updated_at'

const TECHCARDS_MIGRATION_KEY = 'techcards_migrated_v1'
const TECHCARDS_MIGRATION_LOCK_KEY = 'techcards_migration_in_progress'
const MIGRATION_BATCH_SIZE = 40

const TECHCARD_COLUMNS =
  'id,sheet_name,name,name_ru,category,yield,time,method,glass,garnish,photo_url,author,date,technology,ingredients,created_at,updated_at'

let migrationPromise = null
let sessionTokenGetter = null

export function setSupabaseSessionTokenGetter(getter) {
  sessionTokenGetter = typeof getter === 'function' ? getter : null
}

async function resolveAccessToken(options = {}) {
  if (options.accessToken) return options.accessToken
  if (sessionTokenGetter) {
    try {
      const token = await sessionTokenGetter()
      if (token) return token
    } catch {
      // fall back to anon key
    }
  }
  return SUPABASE_ANON_KEY
}

async function postToSupabase(path, options = {}) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase not configured')
  }

  const accessToken = await resolveAccessToken(options)
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Prefer: options.prefer || 'return=representation',
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
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
    const message = data?.message || data?.error || data?.hint || `Supabase request failed (${response.status})`
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
}

function normalizeIngredients(raw) {
  if (!Array.isArray(raw)) return []
  return raw.map((ingredient) => ({
    name: String(ingredient?.name || '').trim(),
    amount: String(ingredient?.amount || '').trim(),
  }))
}

export function cardToTechcardRow(card) {
  const source = card && typeof card === 'object' ? card : {}
  const sheetName = String(source.sheetName || '').trim()
  if (!sheetName) {
    throw new Error('sheetName обязателен для сохранения техкарты')
  }

  return {
    sheet_name: sheetName,
    name: String(source.name || '').trim(),
    name_ru: String(source.nameRu || '').trim(),
    category: String(source.category || '').trim(),
    yield: String(source.yield || '').trim(),
    time: String(source.time || '').trim(),
    method: String(source.method || '').trim(),
    glass: String(source.glass || '').trim(),
    garnish: String(source.garnish || '').trim(),
    photo_url: String(source.photoUrl || '').trim(),
    author: String(source.author || '').trim(),
    date: String(source.date || '').trim(),
    technology: String(source.technology || '').trim(),
    ingredients: normalizeIngredients(source.ingredients),
    updated_at: new Date().toISOString(),
  }
}

export function techcardRowToCard(row) {
  if (!row || typeof row !== 'object') return null
  const sheetName = String(row.sheet_name || '').trim()
  if (!sheetName) return null

  return {
    sheetName,
    name: String(row.name || '').trim(),
    nameRu: String(row.name_ru || '').trim(),
    category: String(row.category || '').trim(),
    yield: String(row.yield || '').trim(),
    time: String(row.time || '').trim(),
    method: String(row.method || '').trim(),
    glass: String(row.glass || '').trim(),
    garnish: String(row.garnish || '').trim(),
    photoUrl: String(row.photo_url || '').trim(),
    author: String(row.author || '').trim(),
    date: String(row.date || '').trim(),
    technology: String(row.technology || '').trim(),
    ingredients: normalizeIngredients(row.ingredients),
  }
}

async function fetchTechcardRows(options = {}) {
  const rows = await postToSupabase(
    `techcards?select=${TECHCARD_COLUMNS}&order=updated_at.desc`,
    { signal: options.signal },
  )
  if (!Array.isArray(rows)) return []
  return rows.map(techcardRowToCard).filter(Boolean)
}

async function countTechcardRows(options = {}) {
  const rows = await postToSupabase('techcards?select=sheet_name', { signal: options.signal })
  return Array.isArray(rows) ? rows.length : 0
}

async function migrateLegacyTechcardsBlob(options = {}) {
  const migrationFlag = await readAppData(TECHCARDS_MIGRATION_KEY, null, options)
  if (migrationFlag?.migrated) {
    return { migrated: false, reason: 'already_migrated', count: migrationFlag.count || 0 }
  }

  const inProgress = await readAppData(TECHCARDS_MIGRATION_LOCK_KEY, null, options)
  if (inProgress?.startedAt) {
    const startedMs = Date.parse(inProgress.startedAt)
    if (!Number.isNaN(startedMs) && Date.now() - startedMs < 5 * 60 * 1000) {
      return { migrated: false, reason: 'in_progress', count: 0 }
    }
  }

  const existingCount = await countTechcardRows(options)
  if (existingCount > 0) {
    await writeAppData(
      TECHCARDS_MIGRATION_KEY,
      { migrated: true, count: existingCount, at: new Date().toISOString(), source: 'existing_table' },
      options,
    )
    return { migrated: false, reason: 'table_has_data', count: existingCount }
  }

  const legacyPayload = await readAppData('techcards', [], options)
  const legacyCards = Array.isArray(legacyPayload) ? legacyPayload : []
  if (legacyCards.length === 0) {
    await writeAppData(
      TECHCARDS_MIGRATION_KEY,
      { migrated: true, count: 0, at: new Date().toISOString(), source: 'empty_legacy' },
      options,
    )
    return { migrated: false, reason: 'no_legacy_data', count: 0 }
  }

  await writeAppData(
    TECHCARDS_MIGRATION_LOCK_KEY,
    { startedAt: new Date().toISOString(), total: legacyCards.length },
    options,
  )

  const deduped = new Map()
  for (const card of legacyCards) {
    try {
      const normalized = techcardRowToCard(cardToTechcardRow(card))
      if (normalized) deduped.set(normalized.sheetName, normalized)
    } catch {
      // skip invalid legacy rows
    }
  }
  const rows = Array.from(deduped.values()).map(cardToTechcardRow)

  let migratedCount = 0
  for (let i = 0; i < rows.length; i += MIGRATION_BATCH_SIZE) {
    const batch = rows.slice(i, i + MIGRATION_BATCH_SIZE)
    await postToSupabase('techcards?on_conflict=sheet_name', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: batch,
      signal: options.signal,
    })
    migratedCount += batch.length
  }

  await writeAppData(
    TECHCARDS_MIGRATION_KEY,
    {
      migrated: true,
      count: migratedCount,
      at: new Date().toISOString(),
      source: 'app_data',
      legacyCount: legacyCards.length,
    },
    options,
  )
  await writeAppData(TECHCARDS_MIGRATION_LOCK_KEY, { finishedAt: new Date().toISOString(), count: migratedCount }, options)

  return { migrated: true, count: migratedCount, legacyCount: legacyCards.length }
}

export async function ensureTechcardsMigrated(options = {}) {
  if (!isSupabaseConfigured) return { migrated: false, reason: 'not_configured', count: 0 }
  if (!migrationPromise) {
    migrationPromise = migrateLegacyTechcardsBlob(options)
      .catch((err) => {
        migrationPromise = null
        throw err
      })
      .then((result) => {
        migrationPromise = null
        return result
      })
  }
  return migrationPromise
}

export async function readTechcardsFromSupabase(options = {}) {
  if (!isSupabaseConfigured) return []

  try {
    await ensureTechcardsMigrated(options)
    return await fetchTechcardRows(options)
  } catch (err) {
    const legacyPayload = await readAppData('techcards', [], options)
    if (Array.isArray(legacyPayload) && legacyPayload.length) {
      return legacyPayload
    }
    throw err
  }
}

export async function upsertTechcardInSupabase(card, options = {}) {
  const row = cardToTechcardRow(card)
  const result = await postToSupabase('techcards?on_conflict=sheet_name', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: row,
    signal: options.signal,
  })
  const saved = Array.isArray(result) ? result[0] : result
  return techcardRowToCard(saved) || card
}

export async function deleteTechcardFromSupabase(sheetName, options = {}) {
  const id = String(sheetName || '').trim()
  if (!id) throw new Error('sheetName обязателен для удаления')
  await postToSupabase(`techcards?sheet_name=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    prefer: 'return=minimal',
    signal: options.signal,
  })
  return { success: true, sheetName: id }
}

/** @deprecated Use upsertTechcardInSupabase / deleteTechcardFromSupabase instead. */
export async function writeTechcardsToSupabase(cards, options = {}) {
  if (!Array.isArray(cards)) return []
  const results = []
  for (const card of cards) {
    results.push(await upsertTechcardInSupabase(card, options))
  }
  return results
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

export function profileRowToProfile(row) {
  if (!row || typeof row !== 'object') return null
  return {
    id: row.id,
    email: String(row.email || '').trim(),
    fullName: String(row.full_name || '').trim(),
    role: row.role === 'admin' ? 'admin' : 'staff',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

export function resolveProfileRoleForEmail(email) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized) return 'staff'
  return ADMIN_EMAILS.includes(normalized) ? 'admin' : 'staff'
}

export function isAdminEmail(email) {
  return resolveProfileRoleForEmail(email) === 'admin'
}

export async function fetchProfile(userId, options = {}) {
  if (!isSupabaseConfigured || !userId) return null
  const rows = await postToSupabase(`profiles?select=${PROFILE_COLUMNS}&id=eq.${encodeURIComponent(userId)}&limit=1`, options)
  if (!Array.isArray(rows) || !rows.length) return null
  return profileRowToProfile(rows[0])
}

/**
 * Sync profile on auth. Never downgrades admin → staff.
 * Email from AUTH is source of truth; empty values do not wipe existing fields.
 */
export async function upsertProfileAfterAuth(user, options = {}) {
  if (!isSupabaseConfigured || !user?.id) return null

  const email = String(user.email || options.email || '').trim().toLowerCase()
  const incomingName = String(options.fullName || user.user_metadata?.full_name || '').trim()
  const existing = await fetchProfile(user.id, options)

  const emailAdmin = resolveProfileRoleForEmail(email)
  const existingAdmin = existing?.role === 'admin'
  const role = emailAdmin === 'admin' || existingAdmin || options.role === 'admin' ? 'admin' : 'staff'

  const payload = {
    id: user.id,
    email: email || existing?.email || '',
    full_name: incomingName || existing?.fullName || '',
    role,
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    await postToSupabase(`profiles?id=eq.${encodeURIComponent(user.id)}`, {
      method: 'PATCH',
      body: payload,
      prefer: 'return=representation',
      accessToken: options.accessToken,
    })
  } else {
    await postToSupabase('profiles', {
      method: 'POST',
      body: payload,
      prefer: 'return=representation',
      accessToken: options.accessToken,
    })
  }

  return fetchProfile(user.id, options)
}
