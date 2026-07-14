import {
  isSupabaseConfigured,
  readSectionsFromSupabase,
  readScheduleFromSupabase,
  readStopListFromSupabase,
  readTechcardsFromSupabase,
  readWriteoffsFromSupabase,
  upsertTechcardInSupabase,
  deleteTechcardFromSupabase,
  writeSectionsToSupabase,
  writeScheduleToSupabase,
  writeStopListToSupabase,
  writeWriteoffsToSupabase,
} from './supabaseDb.js'

const OFFLINE_KEYS = {
  cardsList: 'tk_offline_cards_list_v1',
  cardsAll: 'tk_offline_cards_all_v1',
  sections: 'tk_offline_sections_v1',
  schedule: 'tk_offline_schedule_v1',
  writeoffs: 'tk_offline_writeoffs_v1',
  stopList: 'tk_offline_stoplist_v1',
}

function readOffline(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function writeOffline(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore storage errors
  }
}

const CARD_DB_KEY = 'bb_cards_database_v1'

function readLocalCards() {
  try {
    const raw = localStorage.getItem(CARD_DB_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(Boolean)
  } catch {
    return []
  }
}

function writeLocalCards(cards) {
  try {
    localStorage.setItem(CARD_DB_KEY, JSON.stringify(cards))
  } catch {
    // ignore storage errors
  }
}

function normalizeCardForStorage(cardData, fallbackSheetName = '') {
  const source = cardData && typeof cardData === 'object' ? cardData : {}
  const sheetName = String(source.sheetName || fallbackSheetName || '').trim()
  const resolvedSheetName = sheetName || `bb-card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const ingredients = Array.isArray(source.ingredients)
    ? source.ingredients.map((ingredient) => ({
        name: String(ingredient?.name || '').trim(),
        amount: String(ingredient?.amount || '').trim(),
      }))
    : [{ name: '', amount: '' }]

  return {
    ...source,
    sheetName: resolvedSheetName,
    name: String(source.name || '').trim(),
    nameRu: String(source.nameRu || '').trim(),
    category: String(source.category || '').trim(),
    yield: String(source.yield || '').trim(),
    time: String(source.time || '').trim(),
    method: String(source.method || '').trim(),
    glass: String(source.glass || '').trim(),
    garnish: String(source.garnish || '').trim(),
    photoUrl: String(source.photoUrl || '').trim(),
    author: String(source.author || '').trim(),
    date: String(source.date || new Date().toISOString().slice(0, 10)).trim(),
    technology: String(source.technology || '').trim(),
    ingredients,
  }
}

const mockCards = [
  {
    sheetName: 'Aphrodite',
    name: 'Aphrodite',
    nameRu: 'Афродита',
    category: 'cocktail',
    yield: '150 мл',
    time: '5 мин',
    method: 'Shake',
    glass: 'Шампанское-блюдце',
    garnish: 'Цедра апельсина',
    photoUrl: '',
    author: 'Кравченко Богдан',
    date: '10.03.2025',
    technology: 'Взбить все ингредиенты со льдом в шейкере, процедить в охлажденный бокал.',
    ingredients: [
      { name: 'Ром Bacardi', amount: '50 мл' },
      { name: 'Ликер апельсиновый', amount: '20 мл' },
      { name: 'Сок лимона', amount: '15 мл' },
    ],
  },
  {
    sheetName: 'BerryFizz',
    name: 'Berry Fizz',
    nameRu: 'Берри Физз',
    category: 'mocktail',
    yield: '220 мл',
    time: '4 мин',
    method: 'Build',
    glass: 'Хайбол',
    garnish: 'Мята',
    photoUrl: '',
    author: 'Бар команда',
    date: '05.02.2026',
    technology: 'Собрать в бокале со льдом, аккуратно перемешать барной ложкой.',
    ingredients: [
      { name: 'Пюре ягодное', amount: '30 мл' },
      { name: 'Лайм фреш', amount: '15 мл' },
      { name: 'Содовая', amount: '120 мл' },
    ],
  },
]

const mockSchedule = {
  defaultStart: '09:00',
  defaultEnd: '23:00',
  employees: [{ id: 'e1', name: 'Пример', color: '#dbeafe', hourlyRate: 300 }],
  employeesByMonth: {},
  shifts: [],
  shortageByMonth: {},
  bonusesByMonth: {},
}

const mockWriteoffs = {
  entries: [],
  templates: [
    {
      id: 'tpl-ethiopia',
      title: 'Кофе Эфиопия',
      item: 'Кофе Эфиопия',
      qty: '60',
      unit: 'гр',
      type: 'move',
      reason: 'на Кондитерский',
    },
  ],
}

function offlineWriteoffsState() {
  const cur = readOffline(OFFLINE_KEYS.writeoffs, null)
  if (cur && typeof cur === 'object' && Array.isArray(cur.entries) && Array.isArray(cur.templates)) {
    return { entries: [...cur.entries], templates: [...cur.templates] }
  }
  return {
    entries: Array.isArray(mockWriteoffs.entries) ? [...mockWriteoffs.entries] : [],
    templates: Array.isArray(mockWriteoffs.templates) ? [...mockWriteoffs.templates] : [],
  }
}

function persistOfflineWriteoffs(state) {
  writeOffline(OFFLINE_KEYS.writeoffs, state)
}

function offlineStopListState() {
  const cur = readOffline(OFFLINE_KEYS.stopList, null)
  if (Array.isArray(cur)) return [...cur]
  return []
}

function persistOfflineStopList(state) {
  writeOffline(OFFLINE_KEYS.stopList, state)
}

export function syncWriteoffsOfflineCache(writeoffs) {
  if (writeoffs && typeof writeoffs === 'object') {
    writeOffline(OFFLINE_KEYS.writeoffs, writeoffs)
  }
}

export async function fetchAllCards(options = {}) {
  const localCards = readLocalCards()
  if (isSupabaseConfigured) {
    try {
      const cards = await readTechcardsFromSupabase({ signal: options.signal })
      const normalized = Array.isArray(cards) ? cards.map((card) => normalizeCardForStorage(card)) : []
      writeLocalCards(normalized)
      writeOffline(OFFLINE_KEYS.cardsAll, normalized)
      writeOffline(OFFLINE_KEYS.cardsList, normalized)
      return normalized
    } catch {
      // fall back to local storage
    }
  }

  const cached = readOffline(OFFLINE_KEYS.cardsAll, localCards)
  if (Array.isArray(cached) && cached.length) {
    writeLocalCards(cached)
    return cached
  }
  return localCards.length ? localCards : mockCards
}

export async function fetchCardList(options = {}) {
  const localCards = readLocalCards()
  if (isSupabaseConfigured) {
    try {
      const cards = await readTechcardsFromSupabase({ signal: options.signal })
      const normalized = Array.isArray(cards) ? cards.map((card) => normalizeCardForStorage(card)) : []
      writeLocalCards(normalized)
      writeOffline(OFFLINE_KEYS.cardsList, normalized)
      return normalized
    } catch {
      // fall back to local storage
    }
  }

  const cached = readOffline(OFFLINE_KEYS.cardsList, localCards)
  if (Array.isArray(cached) && cached.length) {
    writeLocalCards(cached)
    return cached
  }
  return localCards.length ? localCards : mockCards
}

export async function fetchCardDetail(sheetName, options = {}) {
  const localCards = readLocalCards()
  const foundLocal = localCards.find((card) => card && card.sheetName === sheetName)

  if (isSupabaseConfigured) {
    try {
      const cards = await readTechcardsFromSupabase({ signal: options.signal })
      const found = Array.isArray(cards)
        ? cards.find((card) => card && card.sheetName === sheetName)
        : null
      if (found) return found
    } catch {
      // fall back to local storage
    }
  }

  const cached = readOffline(OFFLINE_KEYS.cardsAll, localCards)
  const foundCached = Array.isArray(cached)
    ? cached.find((card) => card && card.sheetName === sheetName)
    : null
  return foundCached || foundLocal || mockCards.find((card) => card.sheetName === sheetName) || null
}

export async function updateCard(sheetName, cardData, pin) {
  const normalizedCard = normalizeCardForStorage({ ...(cardData || {}), sheetName }, sheetName)
  const existing = readLocalCards()
  const nextCards = [normalizedCard, ...existing.filter((card) => card && card.sheetName !== normalizedCard.sheetName)]
  writeLocalCards(nextCards)
  writeOffline(OFFLINE_KEYS.cardsAll, nextCards)
  writeOffline(OFFLINE_KEYS.cardsList, nextCards)

  if (isSupabaseConfigured) {
    await upsertTechcardInSupabase(normalizedCard)
  }

  return { success: true, source: 'supabase', sheetName, cardData: normalizedCard, pin }
}

export async function createCard(cardData, pin) {
  const normalizedCard = normalizeCardForStorage(cardData)
  const existing = readLocalCards()
  const nextCards = [normalizedCard, ...existing.filter((card) => card && card.sheetName !== normalizedCard.sheetName)]
  writeLocalCards(nextCards)
  writeOffline(OFFLINE_KEYS.cardsAll, nextCards)
  writeOffline(OFFLINE_KEYS.cardsList, nextCards)

  if (isSupabaseConfigured) {
    await upsertTechcardInSupabase(normalizedCard)
  }

  return { success: true, source: 'supabase', cardData: normalizedCard, pin }
}

export async function deleteCard(sheetName, pin) {
  const existing = readLocalCards().filter((card) => card && card.sheetName !== sheetName)
  writeLocalCards(existing)
  writeOffline(OFFLINE_KEYS.cardsAll, existing)
  writeOffline(OFFLINE_KEYS.cardsList, existing)

  if (isSupabaseConfigured) {
    await deleteTechcardFromSupabase(sheetName)
  }

  return { success: true, source: 'supabase', sheetName, pin }
}

export async function fetchSectionsContent() {
  if (isSupabaseConfigured) {
    try {
      const sections = await readSectionsFromSupabase()
      if (sections && typeof sections === 'object') {
        writeOffline(OFFLINE_KEYS.sections, sections)
        return sections
      }
    } catch {
      // fall back to local storage
    }
  }

  const cached = readOffline(OFFLINE_KEYS.sections, null)
  if (cached && typeof cached === 'object') return cached

  return {
    regulations: {
      title: 'Регламенты',
      points: [
        '# Смена',
        '- Открытие и закрытие точки строго по **чек-листу**.',
        '- В конце смены зафиксировать **списания** и брак.',
        '---',
        '# Санитария и хранение',
        'Соблюдать санитарные нормы и условия хранения ингредиентов по внутренним правилам.',
      ],
    },
    appearance: {
      title: 'Требования к внешнему виду',
      points: [
        '## Общий вид',
        '**Чистая форма** и опрятный внешний вид на протяжении всей смены.',
        '## Детали образа',
        '- Минимум украшений, аккуратные волосы, **закрытая обувь**.',
        '- Личная гигиена и регулярная дезинфекция рук.',
        '> По согласованию с командой — только неароматный дезодорант.',
      ],
    },
    behavior: {
      title: 'Поведение',
      points: [
        '# Общение',
        'Вежливый тон с гостями и коллегами, **внимание** к запросам и очереди.',
        '# Командная работа',
        'Проактивная помощь в **пиковые часы**, равномерная загрузка зоны.',
        '# Конфликты',
        'Спокойная коммуникация: факты вместо обвинений; при эскалации — **руководитель смены**.',
      ],
    },
    rights: {
      title: 'Права и ответственность',
      points: [
        '# Условия труда',
        'Право на **безопасные** условия и понятные задачи.',
        '# Качество и стандарты',
        'Ответственность за напитки, рецептуру и **стандарты** подачи.',
        '# Правила точки',
        'Соблюдение регламентов и бережное отношение к **оборудованию** и продукту.',
      ],
    },
  }
}

export async function updateSectionContent(sectionId, title, points, pin) {
  const next = {
    regulations: {
      title: 'Регламенты',
      points: [
        '# Смена',
        '- Открытие и закрытие точки строго по **чек-листу**.',
        '- В конце смены зафиксировать **списания** и брак.',
        '---',
        '# Санитария и хранение',
        'Соблюдать санитарные нормы и условия хранения ингредиентов по внутренним правилам.',
      ],
    },
    appearance: {
      title: 'Требования к внешнему виду',
      points: [
        '## Общий вид',
        '**Чистая форма** и опрятный внешний вид на протяжении всей смены.',
        '## Детали образа',
        '- Минимум украшений, аккуратные волосы, **закрытая обувь**.',
        '- Личная гигиена и регулярная дезинфекция рук.',
        '> По согласованию с командой — только неароматный дезодорант.',
      ],
    },
    behavior: {
      title: 'Поведение',
      points: [
        '# Общение',
        'Вежливый тон с гостями и коллегами, **внимание** к запросам и очереди.',
        '# Командная работа',
        'Проактивная помощь в **пиковые часы**, равномерная загрузка зоны.',
        '# Конфликты',
        'Спокойная коммуникация: факты вместо обвинений; при эскалации — **руководитель смены**.',
      ],
    },
    rights: {
      title: 'Права и ответственность',
      points: [
        '# Условия труда',
        'Право на **безопасные** условия и понятные задачи.',
        '# Качество и стандарты',
        'Ответственность за напитки, рецептуру и **стандарты** подачи.',
        '# Правила точки',
        'Соблюдение регламентов и бережное отношение к **оборудованию** и продукту.',
      ],
    },
  }

  const current = readOffline(OFFLINE_KEYS.sections, next)
  const merged = {
    ...next,
    ...((current && typeof current === 'object') ? current : {}),
    [sectionId]: {
      ...((current && typeof current === 'object' && current[sectionId]) || {}),
      title,
      points,
    },
  }

  writeOffline(OFFLINE_KEYS.sections, merged)

  if (isSupabaseConfigured) {
    try {
      await writeSectionsToSupabase(merged)
    } catch {
      // keep local storage as the fallback source
    }
  }

  return { success: true, source: 'supabase', sectionId, title, points, pin }
}

export async function fetchSchedule() {
  if (isSupabaseConfigured) {
    try {
      const schedule = await readScheduleFromSupabase()
      if (schedule && typeof schedule === 'object') {
        writeOffline(OFFLINE_KEYS.schedule, schedule)
        return schedule
      }
    } catch {
      // fall back to local storage
    }
  }

  const cached = readOffline(OFFLINE_KEYS.schedule, null)
  if (cached && typeof cached === 'object') return cached
  return mockSchedule
}

export async function updateSchedule(schedule, pin) {
  writeOffline(OFFLINE_KEYS.schedule, schedule)

  if (isSupabaseConfigured) {
    try {
      await writeScheduleToSupabase(schedule)
    } catch {
      // keep local storage as the fallback source
    }
  }

  return { success: true, source: 'supabase', schedule, pin }
}

export async function verifyPayrollPin({ employeeId, pin, monthKey }) {
  if (!employeeId || !pin || !monthKey) {
    throw new Error('Не указан сотрудник, PIN или месяц')
  }
  return {
    success: true,
    payout: {
      hourlyRate: 300,
      hours: 0,
      gross: 0,
      deduction: 0,
      bonus: 0,
      net: 0,
    },
  }
}

export async function fetchWriteoffs() {
  if (isSupabaseConfigured) {
    try {
      const writeoffs = await readWriteoffsFromSupabase()
      writeOffline(OFFLINE_KEYS.writeoffs, writeoffs)
      return writeoffs
    } catch {
      // fall back to local storage
    }
  }

  return offlineWriteoffsState()
}

export async function mutateWriteoffs(payload, pin) {
  const op = String(payload?.op || '').trim()
  if (!op) throw new Error('Не указана операция')

  const state = offlineWriteoffsState()
  if (op === 'append' && payload.entry) {
    state.entries.unshift({ ...payload.entry })
    persistOfflineWriteoffs(state)
    if (isSupabaseConfigured) {
      try {
        await writeWriteoffsToSupabase(state)
      } catch {
        // keep local storage as the fallback source
      }
    }
    return { success: true, source: 'supabase' }
  }
  if (op === 'delete' && payload.id) {
    state.entries = state.entries.filter((e) => e.id !== payload.id)
    persistOfflineWriteoffs(state)
    if (isSupabaseConfigured) {
      try {
        await writeWriteoffsToSupabase(state)
      } catch {
        // keep local storage as the fallback source
      }
    }
    return { success: true, source: 'supabase' }
  }
  if (op === 'update' && payload.entry) {
    const e = payload.entry
    state.entries = state.entries.map((x) => (x.id === e.id ? { ...e } : x))
    persistOfflineWriteoffs(state)
    if (isSupabaseConfigured) {
      try {
        await writeWriteoffsToSupabase(state)
      } catch {
        // keep local storage as the fallback source
      }
    }
    return { success: true, source: 'supabase' }
  }
  if (op === 'templates' && Array.isArray(payload.templates)) {
    state.templates = payload.templates.map((t) => ({ ...t }))
    persistOfflineWriteoffs(state)
    if (isSupabaseConfigured) {
      try {
        await writeWriteoffsToSupabase(state)
      } catch {
        // keep local storage as the fallback source
      }
    }
    return { success: true, source: 'supabase' }
  }

  throw new Error('Неверная операция')
}

export async function fetchStopList() {
  if (isSupabaseConfigured) {
    try {
      const stopList = await readStopListFromSupabase()
      writeOffline(OFFLINE_KEYS.stopList, stopList)
      return stopList
    } catch {
      // fall back to local storage
    }
  }

  return offlineStopListState()
}

export async function mutateStopList(payload) {
  const op = String(payload?.op || '').trim()
  if (!op) throw new Error('Не указана операция')

  const state = offlineStopListState()
  if (op === 'append' && payload.entry) {
    const next = [{ ...payload.entry }, ...state.filter((x) => x.id !== payload.entry.id)]
    persistOfflineStopList(next)
    if (isSupabaseConfigured) {
      try {
        await writeStopListToSupabase(next)
      } catch {
        // keep local storage as the fallback source
      }
    }
    return { success: true, source: 'supabase' }
  }
  if (op === 'delete' && payload.id) {
    const next = state.filter((x) => x.id !== payload.id)
    persistOfflineStopList(next)
    if (isSupabaseConfigured) {
      try {
        await writeStopListToSupabase(next)
      } catch {
        // keep local storage as the fallback source
      }
    }
    return { success: true, source: 'supabase' }
  }

  throw new Error('Неверная операция')
}
