const SPREADSHEET_ID = '1-Y32ev-G5ooRWcRMHbiSRShnyg4yb6ysF9s4kzJqiLo'
const PIN = '1234'
const LIST_CACHE_KEY = 'cards_list_v1'
const LIST_CACHE_TTL_SEC = 120
const SECTIONS_SHEET_NAME = '_APP_CONTENT'
const SCHEDULE_SHEET_NAME = '_SCHEDULE'
/** Месячные листы: _SCHEDULE_2026-03 (JSON смен + недостача за месяц) */
const SCHEDULE_MONTH_PREFIX = '_SCHEDULE_'
const STATS_SHEET_NAME = '_APP_STATS'
const STOP_LIST_SHEET_NAME = '_STOP_LIST'
/** Лента списаний: A–H — позиция, кол-во, ед., тип, сотрудник, дата, причина, UUID. Сначала ищем «старые» имена без лишнего _. */
var WRITE_LOG_SHEET_NAMES = ['_WRITE_LOG', '_WRITE_LOG_']
var WRITE_TPL_SHEET_NAMES = ['_WRITE_TPL', '_WRITE_TPL_']

function doGet(e) {
  const action = e.parameter.action
  if (action === 'getList') return getList()
  if (action === 'getCard') return getCard(e.parameter.sheetName)
  if (action === 'getAll') return getAll()
  if (action === 'getSections') return getSections()
  if (action === 'getSchedule') return getSchedule()
  if (action === 'getWriteoffs') return getWriteoffs()
  if (action === 'getStopList') return getStopList()
  if (action === 'appendSimpleWriteoff') return appendSimpleWriteoff_(e.parameter)
  if (action === 'deleteSimpleWriteoff') return deleteSimpleWriteoff_(e.parameter)
  if (action === 'updateSimpleWriteoff') return updateSimpleWriteoff_(e.parameter)
  if (action === 'appendStopListItem') return appendStopListItem_(e.parameter)
  if (action === 'deleteStopListItem') return deleteStopListItem_(e.parameter)
  if (action === 'logVisit') return logAppVisit()
  return jsonResponse({ error: 'unknown action' })
}

function doPost(e) {
  let body
  try {
    const raw = e.postData && e.postData.contents != null ? String(e.postData.contents) : ''
    body = raw ? JSON.parse(raw) : {}
  } catch (err) {
    return jsonResponse({ error: 'Некорректный JSON в теле запроса' })
  }
  if (!body || typeof body !== 'object') return jsonResponse({ error: 'Пустое тело запроса' })
  if (body.action === 'create') return createSheet(body)
  if (body.action === 'update') return updateSheet(body)
  if (body.action === 'delete') return deleteSheet(body)
  if (body.action === 'updateSection') return updateSection(body)
  if (body.action === 'updateSchedule') return updateSchedule(body)
  if (body.action === 'updateWriteoffs') return updateWriteoffs(body)
  if (body.action === 'appendSimpleWriteoffPost') return appendSimpleWriteoffPost_(body)
  if (body.action === 'appendStopListItem') return appendStopListItem_(body)
  if (body.action === 'deleteStopListItem') return deleteStopListItem_(body)
  return jsonResponse({ error: 'unknown action' })
}

function getStopListSheet_(ss) {
  let sh = ss.getSheetByName(STOP_LIST_SHEET_NAME)
  if (!sh) {
    sh = ss.insertSheet(STOP_LIST_SHEET_NAME)
    sh.getRange(1, 1, 1, 3).setValues([['item', 'date', 'id']])
    sh.hideSheet()
  }
  return sh
}

function normalizeStopDate_(value) {
  const ymd = normalizeWriteoffDateYmd_(value)
  if (ymd) return ymd
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
}

function readStopList_(sheet) {
  const last = sheet.getLastRow()
  if (last < 2) return []
  const data = sheet.getRange(2, 1, last - 1, 3).getValues()
  const out = []
  for (var i = 0; i < data.length; i++) {
    const row = data[i]
    const item = String(row[0] || '').trim()
    if (!item) continue
    const date = normalizeStopDate_(row[1])
    const id = String(row[2] || '').trim() || Utilities.getUuid()
    out.push({ id: id, item: item, date: date })
  }
  out.sort(function (a, b) {
    return String(b.date || '').localeCompare(String(a.date || ''))
  })
  return out
}

function getStopList() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  const sh = getStopListSheet_(ss)
  return jsonResponse({ stopList: readStopList_(sh) })
}

function appendStopListItem_(params) {
  try {
    const item = String(params.item || '').trim()
    const date = normalizeStopDate_(params.date)
    if (!item) return jsonResponse({ error: 'item required' })
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
    const sh = getStopListSheet_(ss)
    const id = Utilities.getUuid()
    const nextRow = sh.getLastRow() + 1
    sh.getRange(nextRow, 1, 1, 3).setValues([[item, date, id]])
    return jsonResponse({ success: true, entry: { id: id, item: item, date: date } })
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err)
    return jsonResponse({ error: 'таблица: ' + msg })
  }
}

function deleteStopListItem_(params) {
  const id = String(params.id || '').trim()
  if (!id) return jsonResponse({ error: 'id required' })
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  const sh = getStopListSheet_(ss)
  const last = sh.getLastRow()
  if (last < 2) return jsonResponse({ error: 'запись не найдена' })
  const ids = sh.getRange(2, 3, last - 1, 1).getValues()
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim() === id) {
      sh.deleteRow(i + 2)
      return jsonResponse({ success: true })
    }
  }
  return jsonResponse({ error: 'запись не найдена' })
}

function appendSimpleWriteoffPost_(body) {
  return appendSimpleWriteoff_({
    pin: body.pin,
    item: body.item,
    qty: body.qty,
    unit: body.unit,
    typ: body.typ || body.type,
    emp: body.emp || body.employee,
    date: body.date,
    reason: body.reason,
  })
}

function normalizeWriteoffTemplate_(t) {
  return {
    id: String((t && t.id) || '').trim() || Utilities.getUuid(),
    title: String((t && t.title) || '').trim(),
    item: String((t && t.item) || '').trim(),
    qty: String((t && t.qty) || '').trim(),
    unit: String((t && t.unit) || '').trim(),
    type: String((t && t.type) || '').trim() === 'move' ? 'move' : 'writeoff',
    reason: String((t && t.reason) || '').trim(),
  }
}

function getFirstExistingSheet_(ss, names) {
  for (var i = 0; i < names.length; i++) {
    var sh = ss.getSheetByName(names[i])
    if (sh) return sh
  }
  return null
}

function getWriteLogSheet_(ss) {
  var sh = getFirstExistingSheet_(ss, WRITE_LOG_SHEET_NAMES)
  if (!sh) {
    sh = ss.insertSheet(WRITE_LOG_SHEET_NAMES[0])
    sh.hideSheet()
  }
  return sh
}

function getWriteTplSheet_(ss) {
  var sh = getFirstExistingSheet_(ss, WRITE_TPL_SHEET_NAMES)
  if (!sh) {
    sh = ss.insertSheet(WRITE_TPL_SHEET_NAMES[0])
    sh.hideSheet()
  }
  return sh
}

function readWriteLogEntries_(sheet) {
  const last = sheet.getLastRow()
  if (last < 1) return []
  const data = sheet.getRange(1, 1, last, 8).getValues()
  const out = []
  for (var r = 0; r < data.length; r++) {
    const row = data[r]
    const item = String(row[0] || '').trim()
    if (!item) continue
    const typRaw = String(row[3] || '').trim()
    const type = typRaw === 'move' || typRaw === 'перемещение' ? 'move' : 'writeoff'
    const hid = String(row[7] || '').trim()
    const id = hid || 'wr_row_' + (r + 1)
    const date = normalizeWriteoffDateYmd_(row[5])
    out.push({
      id: id,
      item: item,
      qty: String(row[1] || '').trim(),
      unit: String(row[2] || '').trim() || 'гр',
      type: type,
      employee: String(row[4] || '').trim(),
      date: date,
      reason: String(row[6] || '').trim(),
      createdAt: date,
    })
  }
  return out
}

function readWriteTplRows_(sheet) {
  const last = sheet.getLastRow()
  if (last < 1) return []
  const data = sheet.getRange(1, 1, last, 7).getValues()
  const out = []
  for (var i = 0; i < data.length; i++) {
    const row = data[i]
    const title = String(row[0] || '').trim()
    if (!title || !String(row[2] || '').trim()) continue
    const hid = String(row[6] || '').trim()
    out.push({
      id: hid || 'tpl_r' + (i + 1),
      title: title,
      item: String(row[1] || '').trim(),
      qty: String(row[2] || '').trim(),
      unit: String(row[3] || '').trim() || 'гр',
      type: String(row[4] || '').trim() === 'move' ? 'move' : 'writeoff',
      reason: String(row[5] || '').trim(),
    })
  }
  return out
}

function normalizeWriteoffDateYmd_(value) {
  var tz = Session.getScriptTimeZone()
  if (Object.prototype.toString.call(value) === '[object Date]') {
    var dt = /** @type {Date} */ (value)
    if (isNaN(dt.getTime())) return ''
    return Utilities.formatDate(dt, tz, 'yyyy-MM-dd')
  }
  if (typeof value === 'number' && value > 200 && value < 80000) {
    var base = new Date(1899, 11, 30)
    var serial = new Date(base.getTime() + Math.round(value) * 24 * 60 * 60 * 1000)
    if (isNaN(serial.getTime())) return ''
    return Utilities.formatDate(serial, tz, 'yyyy-MM-dd')
  }
  var t = String(value || '').trim()
  if (!t) return ''
  var iso = t.match(/^(\d{4}-\d{2}-\d{2})/)
  if (iso) return iso[1]
  var tIdx = t.indexOf('T')
  if (tIdx > 0) {
    var head = t.substring(0, tIdx)
    if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head
  }
  var dm = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  if (dm) {
    var d = dm[1].length === 1 ? '0' + dm[1] : dm[1]
    var mo = dm[2].length === 1 ? '0' + dm[2] : dm[2]
    return dm[3] + '-' + mo + '-' + d
  }
  var slash = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (slash) {
    var d2 = slash[1].length === 1 ? '0' + slash[1] : slash[1]
    var mo2 = slash[2].length === 1 ? '0' + slash[2] : slash[2]
    return slash[3] + '-' + mo2 + '-' + d2
  }
  return ''
}

function getWriteoffs() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  const logSh = getWriteLogSheet_(ss)
  const tplSh = getWriteTplSheet_(ss)
  const entries = readWriteLogEntries_(logSh)
  const templates = readWriteTplRows_(tplSh)
  return jsonResponse({ writeoffs: { entries: entries, templates: templates } })
}

function findLogRowByEntryId_(sheet, id) {
  const target = String(id || '').trim()
  if (!target) return -1
  const last = sheet.getLastRow()
  if (last < 1) return -1
  const ids = sheet.getRange(1, 8, last, 8).getValues()
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim() === target) return i + 1
  }
  return -1
}

function simpleWriteoffPinOk_(params) {
  const p = params.pin != null ? String(params.pin) : ''
  if (p && p !== PIN) return false
  return true
}

function appendSimpleWriteoff_(params) {
  if (!simpleWriteoffPinOk_(params)) return jsonResponse({ error: 'invalid pin' })
  try {
    const item = String(params.item || '').trim()
    const qty = String(params.qty || '').trim()
    const unit = String(params.unit || '').trim() || 'гр'
    const typ = String(params.typ || params.type || '').trim() === 'move' ? 'move' : 'writeoff'
    const employee = String(params.emp || params.employee || '').trim()
    const date = normalizeWriteoffDateYmd_(params.date)
    const reason = String(params.reason || '').trim()
    if (!item || !qty || !employee || !date) return jsonResponse({ error: 'нужны item, qty, emp, date' })
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
    const sheet = getWriteLogSheet_(ss)
    const nextRow = getNextEmptyRowInColumnA_(sheet)
    const id = Utilities.getUuid()
    sheet.getRange(nextRow, 1, 1, 8).setValues([[item, qty, unit, typ, employee, date, reason, id]])
    const entry = {
      id: id,
      item: item,
      qty: qty,
      unit: unit,
      type: typ,
      employee: employee,
      date: date,
      reason: reason,
      createdAt: date,
    }
    return jsonResponse({ success: true, entry: entry })
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err)
    return jsonResponse({ error: 'таблица: ' + msg })
  }
}

function getNextEmptyRowInColumnA_(sheet) {
  const lr = Math.max(sheet.getLastRow(), 1)
  const colA = sheet.getRange(1, 1, lr, 1).getValues()
  for (var i = 0; i < colA.length; i++) {
    if (!String(colA[i][0] || '').trim()) return i + 1
  }
  return lr + 1
}

function deleteSimpleWriteoff_(params) {
  if (!simpleWriteoffPinOk_(params)) return jsonResponse({ error: 'invalid pin' })
  const id = String(params.id || '').trim()
  if (!id) return jsonResponse({ error: 'id required' })
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  const sheet = getWriteLogSheet_(ss)
  const row = findLogRowByEntryId_(sheet, id)
  if (row < 0) return jsonResponse({ error: 'запись не найдена' })
  sheet.deleteRow(row)
  return jsonResponse({ success: true })
}

function updateSimpleWriteoff_(params) {
  if (!simpleWriteoffPinOk_(params)) return jsonResponse({ error: 'invalid pin' })
  const id = String(params.id || '').trim()
  const item = String(params.item || '').trim()
  const qty = String(params.qty || '').trim()
  const unit = String(params.unit || '').trim() || 'гр'
  const typ = String(params.typ || '').trim() === 'move' ? 'move' : 'writeoff'
  const employee = String(params.emp || params.employee || '').trim()
  const dateNorm = normalizeWriteoffDateYmd_(params.date)
  const reason = String(params.reason || '').trim()
  if (!id || !item || !qty || !employee || !dateNorm) return jsonResponse({ error: 'нужны id, item, qty, emp, date' })
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  const sheet = getWriteLogSheet_(ss)
  const row = findLogRowByEntryId_(sheet, id)
  if (row < 0) return jsonResponse({ error: 'запись не найдена' })
  sheet.getRange(row, 1, 1, 8).setValues([[item, qty, unit, typ, employee, dateNorm, reason, id]])
  return jsonResponse({
    success: true,
    entry: {
      id: id,
      item: item,
      qty: qty,
      unit: unit,
      type: typ,
      employee: employee,
      date: dateNorm,
      reason: reason,
      createdAt: dateNorm,
    },
  })
}

function updateWriteoffTemplates_(body) {
  const src = body.templates
  if (!Array.isArray(src)) return jsonResponse({ error: 'templates must be an array' })
  const templates = src
    .map(normalizeWriteoffTemplate_)
    .filter(function (t) {
      return t.title && t.item && t.qty
    })
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  const sh = getWriteTplSheet_(ss)
  const last = sh.getLastRow()
  if (last > 0) sh.getRange(1, 1, last, 7).clearContent()
  for (var i = 0; i < templates.length; i++) {
    const t = templates[i]
    const tid = String(t.id || '').trim() || Utilities.getUuid()
    sh.getRange(i + 1, 1, 1, 7).setValues([[t.title, t.item, t.qty, t.unit || 'гр', t.type, t.reason, tid]])
  }
  return jsonResponse({ success: true })
}

function updateWriteoffs(body) {
  if (body.pin && body.pin !== PIN) return jsonResponse({ error: 'invalid pin' })
  const op = String(body.op || '').trim()
  if (op === 'templates') return updateWriteoffTemplates_(body)
  if (op === 'update' && body.entry) {
    const e = body.entry
    return updateSimpleWriteoff_({
      pin: body.pin,
      id: String(e.id || ''),
      item: e.item,
      qty: e.qty,
      unit: e.unit,
      typ: e.type,
      emp: e.employee,
      date: e.date,
      reason: e.reason,
    })
  }
  return jsonResponse({ error: 'Используйте GET для append/delete/update или POST op=templates' })
}

function getDefaultSectionsObject() {
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

function getSectionsSheet_(ss) {
  let sheet = ss.getSheetByName(SECTIONS_SHEET_NAME)
  if (!sheet) {
    sheet = ss.insertSheet(SECTIONS_SHEET_NAME)
    sheet.getRange(1, 1, 1, 3).setValues([['sectionId', 'title', 'points']])
    const defaults = getDefaultSectionsObject()
    const rows = Object.keys(defaults).map((sectionId) => {
      const data = defaults[sectionId]
      return [sectionId, data.title, (data.points || []).join('\n')]
    })
    if (rows.length) {
      sheet.getRange(2, 1, rows.length, 3).setValues(rows)
    }
    sheet.hideSheet()
  }
  return sheet
}

function getSections() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  const sheet = getSectionsSheet_(ss)
  const lastRow = sheet.getLastRow()
  const defaults = getDefaultSectionsObject()
  if (lastRow < 2) return jsonResponse({ sections: defaults })

  const rows = sheet.getRange(2, 1, lastRow - 1, 3).getValues()
  const sections = {}
  rows.forEach((row) => {
    const sectionId = String(row[0] || '').trim()
    if (!sectionId) return
    const base = defaults[sectionId] || { title: sectionId, points: [] }
    const title = String(row[1] || '').trim() || base.title
    const pointsText = String(row[2] || '')
    const points = pointsText
      .split(/\r\n|\n|\r/)
      .map(function (line) {
        return String(line || '').replace(/\u00a0/g, ' ').trim()
      })
      .filter(Boolean)
    sections[sectionId] = {
      title: title,
      points: points.length ? points : base.points,
    }
  })

  return jsonResponse({ sections: { ...defaults, ...sections } })
}

function updateSection(body) {
  if (body.pin && body.pin !== PIN) return jsonResponse({ error: 'invalid pin' })
  const sectionId = String(body.sectionId || '').trim()
  if (!sectionId) return jsonResponse({ error: 'sectionId is required' })
  const points = Array.isArray(body.points) ? body.points : []
  const safePoints = points.map((p) => String(p || '').trim()).filter(Boolean)
  const title = String(body.title || '').trim()

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  const sheet = getSectionsSheet_(ss)
  const lastRow = sheet.getLastRow()
  const rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues() : []
  const idx = rows.findIndex((row) => String(row[0] || '').trim() === sectionId)
  const targetRow = idx === -1 ? lastRow + 1 : idx + 2
  const defaults = getDefaultSectionsObject()
  const defaultTitle = defaults[sectionId] ? defaults[sectionId].title : sectionId
  const nextTitle = title || defaultTitle
  const pointsText = safePoints.join('\n')

  sheet.getRange(targetRow, 1, 1, 3).setValues([[sectionId, nextTitle, pointsText]])
  return jsonResponse({ success: true })
}

function shouldIncludeSheetInCardList_(sheetName) {
  const n = String(sheetName || '')
  if (
    n === SECTIONS_SHEET_NAME ||
    n === SCHEDULE_SHEET_NAME ||
    n === STATS_SHEET_NAME ||
    n === STOP_LIST_SHEET_NAME ||
    n === '_WRITEOFFS' ||
    n === '_WRITE_LOG' ||
    n === '_WRITE_TPL' ||
    n === '_WRITE_LOG_' ||
    n === '_WRITE_TPL_'
  )
    return false
  if (n.indexOf(SCHEDULE_MONTH_PREFIX) === 0 && n.length > SCHEDULE_MONTH_PREFIX.length) return false
  return true
}

/** Увеличивает счётчик открытий приложения (ячейка A1 на скрытом листе). */
function logAppVisit() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  let sheet = ss.getSheetByName(STATS_SHEET_NAME)
  if (!sheet) {
    sheet = ss.insertSheet(STATS_SHEET_NAME)
    sheet.getRange(1, 1).setValue(0)
    sheet.getRange(1, 2).setValue('Счётчик открытий веб-приложения')
    sheet.hideSheet()
  }
  const lock = LockService.getScriptLock()
  lock.waitLock(10000)
  try {
    const cell = sheet.getRange(1, 1)
    const prev = parseInt(String(cell.getValue() || '0'), 10)
    const next = (isNaN(prev) ? 0 : Math.max(0, prev)) + 1
    cell.setValue(next)
    return jsonResponse({ visitCount: next })
  } finally {
    lock.releaseLock()
  }
}

function getAll() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  const cards = ss
    .getSheets()
    .filter((sheet) => shouldIncludeSheetInCardList_(sheet.getName()))
    .map((sheet) => parseSheet(sheet, true))
  return jsonResponse({ cards })
}

function getList() {
  const cache = CacheService.getScriptCache()
  const cached = cache.get(LIST_CACHE_KEY)
  if (cached) {
    return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON)
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  const cards = ss
    .getSheets()
    .filter((sheet) => shouldIncludeSheetInCardList_(sheet.getName()))
    .map((sheet) => parseSheet(sheet, false))
  const payload = JSON.stringify({ cards })
  cache.put(LIST_CACHE_KEY, payload, LIST_CACHE_TTL_SEC)
  return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON)
}

function getCard(sheetName) {
  const name = String(sheetName || '').trim()
  if (!name) return jsonResponse({ error: 'sheetName is required' })
  if (!shouldIncludeSheetInCardList_(name)) return jsonResponse({ error: 'sheet not found' })
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  const sheet = ss.getSheetByName(name)
  if (!sheet) return jsonResponse({ error: 'sheet not found' })
  return jsonResponse({ card: parseSheet(sheet, true) })
}

function parseSheet(sheet, includeDetails) {
  const name = sheet.getName()
  const meta = sheet.getRange(1, 2, 12, 1).getValues().map((row) => row[0])
  const get = (index) => (meta[index] !== undefined ? meta[index] : '')
  const card = {
    sheetName: name,
    name: get(0),
    nameRu: get(1),
    category: get(2),
    yield: get(3),
    time: get(4),
    method: get(5),
    glass: get(6),
    garnish: get(7),
    photoUrl: get(8),
    author: get(9),
    date: get(10),
    technology: includeDetails ? get(11) : '',
    ingredients: [],
    isPartial: !includeDetails,
  }

  if (includeDetails) {
    const ingredients = []
    const lastRow = sheet.getLastRow()
    if (lastRow >= 14) {
      const ingredientRange = sheet.getRange(14, 1, lastRow - 13, 2).getValues()
      ingredientRange.forEach((row) => {
        if (row[0]) ingredients.push({ name: row[0], amount: row[1] || '' })
      })
    }
    card.ingredients = ingredients
  }
  return card
}

function updateSheet(body) {
  if (body.pin && body.pin !== PIN) return jsonResponse({ error: 'invalid pin' })
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  const sheet = ss.getSheetByName(body.sheetName)
  if (!sheet) return jsonResponse({ error: 'sheet not found' })

  const d = body.data
  const set = (row, val) => sheet.getRange(row, 2).setValue(val || '')
  set(1, d.name)
  set(2, d.nameRu)
  set(3, d.category)
  set(4, d.yield)
  set(5, d.time)
  set(6, d.method)
  set(7, d.glass)
  set(8, d.garnish)
  set(9, d.photoUrl)
  set(10, d.author)
  set(11, d.date)
  set(12, d.technology)
  sheet.getRange(14, 1, 50, 2).clearContent()
  ;(d.ingredients || []).forEach((ing, i) => {
    sheet.getRange(14 + i, 1).setValue(ing.name || '')
    sheet.getRange(14 + i, 2).setValue(ing.amount || '')
  })
  clearListCache()
  return jsonResponse({ success: true })
}

function createSheet(body) {
  if (body.pin && body.pin !== PIN) return jsonResponse({ error: 'invalid pin' })
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  const d = body.data || {}
  const sheetName = String(d.sheetName || '').trim()
  if (!sheetName) return jsonResponse({ error: 'sheetName is required' })
  if (ss.getSheetByName(sheetName)) return jsonResponse({ error: 'sheet already exists' })

  const sheet = ss.insertSheet(sheetName)
  const set = (row, val) => sheet.getRange(row, 2).setValue(val || '')
  set(1, d.name)
  set(2, d.nameRu)
  set(3, d.category)
  set(4, d.yield)
  set(5, d.time)
  set(6, d.method)
  set(7, d.glass)
  set(8, d.garnish)
  set(9, d.photoUrl)
  set(10, d.author)
  set(11, d.date)
  set(12, d.technology)
  ;(d.ingredients || []).forEach((ing, i) => {
    sheet.getRange(14 + i, 1).setValue(ing.name || '')
    sheet.getRange(14 + i, 2).setValue(ing.amount || '')
  })
  clearListCache()
  return jsonResponse({ success: true })
}

function deleteSheet(body) {
  if (body.pin && body.pin !== PIN) return jsonResponse({ error: 'invalid pin' })
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  const sheet = ss.getSheetByName(body.sheetName)
  if (!sheet) return jsonResponse({ error: 'sheet not found' })
  ss.deleteSheet(sheet)
  clearListCache()
  return jsonResponse({ success: true })
}

function clearListCache() {
  CacheService.getScriptCache().remove(LIST_CACHE_KEY)
}

function getDefaultScheduleData_() {
  return {
    defaultStart: '09:00',
    defaultEnd: '23:00',
    employees: [],
    employeesByMonth: {},
    shifts: [],
    shortageByMonth: {},
    bonusesByMonth: {},
  }
}

function getScheduleSheet_(ss) {
  let sheet = ss.getSheetByName(SCHEDULE_SHEET_NAME)
  if (!sheet) {
    sheet = ss.insertSheet(SCHEDULE_SHEET_NAME)
    sheet.getRange(1, 1).setValue(JSON.stringify(getDefaultScheduleData_()))
    sheet.getRange(2, 1).setValue('График: сотрудники в A1; смены по месяцам — листы _SCHEDULE_YYYY-MM.')
    sheet.hideSheet()
  }
  return sheet
}

function isScheduleMonthSheetName_(name) {
  const n = String(name || '')
  if (n.indexOf(SCHEDULE_MONTH_PREFIX) !== 0) return false
  const key = n.substring(SCHEDULE_MONTH_PREFIX.length)
  return /^[0-9]{4}-[0-9]{2}$/.test(key)
}

function scheduleMonthSheetName_(monthKey) {
  return SCHEDULE_MONTH_PREFIX + String(monthKey || '').trim()
}

function monthKeyFromShiftDate_(dateStr) {
  const d = String(dateStr || '').trim()
  if (d.length < 7) return ''
  const mk = d.substring(0, 7)
  return /^[0-9]{4}-[0-9]{2}$/.test(mk) ? mk : ''
}

/**
 * Старый формат: всё в A1 _SCHEDULE.
 * Переносим смены, недостачу и бонусы по месячным листам.
 */
function migrateLegacyScheduleIfNeeded_(ss) {
  const sheet = getScheduleSheet_(ss)
  const raw = sheet.getRange(1, 1).getValue()
  if (!raw || !String(raw).trim()) return
  let parsed
  try {
    parsed = JSON.parse(String(raw))
  } catch (e) {
    return
  }
  if (!parsed || typeof parsed !== 'object') return
  const shifts = Array.isArray(parsed.shifts) ? parsed.shifts : []
  if (!shifts.length) return
  const byMonth = {}
  shifts.forEach(function (s) {
    const mk = monthKeyFromShiftDate_(s.date)
    if (!mk) return
    if (!byMonth[mk]) byMonth[mk] = []
    byMonth[mk].push(s)
  })
  const shortageByMonth =
    parsed.shortageByMonth && typeof parsed.shortageByMonth === 'object' && !Array.isArray(parsed.shortageByMonth)
      ? parsed.shortageByMonth
      : {}
  const bonusesByMonth =
    parsed.bonusesByMonth && typeof parsed.bonusesByMonth === 'object' && !Array.isArray(parsed.bonusesByMonth)
      ? parsed.bonusesByMonth
      : {}
  for (var mk in byMonth) {
    if (!byMonth.hasOwnProperty(mk)) continue
    const sm = {}
    sm[mk] = shortageByMonth[mk] !== undefined ? Number(shortageByMonth[mk]) || 0 : 0
    const bm = {}
    if (bonusesByMonth[mk] && typeof bonusesByMonth[mk] === 'object' && !Array.isArray(bonusesByMonth[mk])) {
      bm[mk] = bonusesByMonth[mk]
    }
    writeMonthScheduleSheet_(ss, mk, {
      employees: Array.isArray(parsed.employees) ? parsed.employees : [],
      shifts: byMonth[mk],
      shortageByMonth: sm,
      bonusesByMonth: bm,
    })
  }
  for (var key in shortageByMonth) {
    if (!shortageByMonth.hasOwnProperty(key)) continue
    if (byMonth[key]) continue
    const sm = {}
    sm[key] = Number(shortageByMonth[key]) || 0
    const bm = {}
    if (bonusesByMonth[key] && typeof bonusesByMonth[key] === 'object' && !Array.isArray(bonusesByMonth[key])) {
      bm[key] = bonusesByMonth[key]
    }
    writeMonthScheduleSheet_(ss, key, {
      employees: Array.isArray(parsed.employees) ? parsed.employees : [],
      shifts: [],
      shortageByMonth: sm,
      bonusesByMonth: bm,
    })
  }
  for (var bkey in bonusesByMonth) {
    if (!bonusesByMonth.hasOwnProperty(bkey)) continue
    if (byMonth[bkey] || shortageByMonth[bkey] !== undefined) continue
    const bm = {}
    bm[bkey] = bonusesByMonth[bkey]
    writeMonthScheduleSheet_(ss, bkey, {
      employees: Array.isArray(parsed.employees) ? parsed.employees : [],
      shifts: [],
      shortageByMonth: {},
      bonusesByMonth: bm,
    })
  }
  const nextGlobal = {
    defaultStart: parsed.defaultStart || '09:00',
    defaultEnd: parsed.defaultEnd || '23:00',
    employees: Array.isArray(parsed.employees) ? parsed.employees : [],
    employeesByMonth: {},
    shifts: [],
    shortageByMonth: {},
    bonusesByMonth: {},
  }
  sheet.getRange(1, 1).setValue(JSON.stringify(nextGlobal))
}

function writeMonthScheduleSheet_(ss, monthKey, payload) {
  const name = scheduleMonthSheetName_(monthKey)
  let sh = ss.getSheetByName(name)
  if (!sh) {
    sh = ss.insertSheet(name)
    sh.getRange(2, 1).setValue('График ' + monthKey + ' (JSON в A1).')
    sh.hideSheet()
  }
  sh.getRange(1, 1).setValue(JSON.stringify(payload))
}

function readMonthSheetPayload_(sheet) {
  const raw = sheet.getRange(1, 1).getValue()
  if (!raw || !String(raw).trim()) return { employees: [], shifts: [], shortageByMonth: {}, bonusesByMonth: {} }
  try {
    const p = JSON.parse(String(raw))
    if (!p || typeof p !== 'object') return { employees: [], shifts: [], shortageByMonth: {}, bonusesByMonth: {} }
    return {
      employees: Array.isArray(p.employees) ? p.employees : [],
      shifts: Array.isArray(p.shifts) ? p.shifts : [],
      shortageByMonth:
        p.shortageByMonth && typeof p.shortageByMonth === 'object' && !Array.isArray(p.shortageByMonth)
          ? p.shortageByMonth
          : {},
      bonusesByMonth:
        p.bonusesByMonth && typeof p.bonusesByMonth === 'object' && !Array.isArray(p.bonusesByMonth)
          ? p.bonusesByMonth
          : {},
    }
  } catch (e) {
    return { employees: [], shifts: [], shortageByMonth: {}, bonusesByMonth: {} }
  }
}

function getSchedule() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  migrateLegacyScheduleIfNeeded_(ss)
  const sheet = getScheduleSheet_(ss)
  const raw = sheet.getRange(1, 1).getValue()
  let schedule = getDefaultScheduleData_()
  if (raw && String(raw).trim()) {
    try {
      const parsed = JSON.parse(String(raw))
      if (parsed && typeof parsed === 'object') {
        schedule = {
          defaultStart: parsed.defaultStart || schedule.defaultStart,
          defaultEnd: parsed.defaultEnd || schedule.defaultEnd,
          employees: Array.isArray(parsed.employees) ? parsed.employees : [],
          shifts: [],
          shortageByMonth: {},
          bonusesByMonth: {},
        }
      }
    } catch (e) {
      // keep default
    }
  }
  const allShifts = []
  const allShortage = {}
  const allBonuses = {}
  const employeesByMonth = {}
  ss.getSheets().forEach(function (sh) {
    if (!isScheduleMonthSheetName_(sh.getName())) return
    var mk = sh.getName().substring(SCHEDULE_MONTH_PREFIX.length)
    const part = readMonthSheetPayload_(sh)
    if (Array.isArray(part.employees)) {
      employeesByMonth[String(mk)] = part.employees
    }
    part.shifts.forEach(function (s) {
      allShifts.push(s)
    })
    for (var k in part.shortageByMonth) {
      if (part.shortageByMonth.hasOwnProperty(k)) {
        var v = Number(part.shortageByMonth[k])
        if (!isNaN(v) && v >= 0) allShortage[String(k)] = v
      }
    }
    for (var bmk in part.bonusesByMonth) {
      if (!part.bonusesByMonth.hasOwnProperty(bmk)) continue
      var src = part.bonusesByMonth[bmk]
      if (!src || typeof src !== 'object' || Array.isArray(src)) continue
      var clean = {}
      for (var empId in src) {
        if (!src.hasOwnProperty(empId)) continue
        var bn = Number(src[empId])
        if (!isNaN(bn) && bn >= 0) clean[String(empId)] = bn
      }
      if (Object.keys(clean).length) allBonuses[String(bmk)] = clean
    }
  })
  schedule.shifts = allShifts
  schedule.shortageByMonth = allShortage
  schedule.bonusesByMonth = allBonuses
  schedule.employeesByMonth = employeesByMonth
  schedule.employees = []
  return jsonResponse({ schedule })
}

function updateSchedule(body) {
  if (body.pin && body.pin !== PIN) return jsonResponse({ error: 'invalid pin' })
  const next = body.schedule
  if (!next || typeof next !== 'object') return jsonResponse({ error: 'schedule is required' })
  var shortageByMonth = {}
  if (next.shortageByMonth && typeof next.shortageByMonth === 'object' && !Array.isArray(next.shortageByMonth)) {
    for (var key in next.shortageByMonth) {
      if (next.shortageByMonth.hasOwnProperty(key)) {
        var sn = Number(next.shortageByMonth[key])
        if (!isNaN(sn) && sn >= 0) shortageByMonth[String(key)] = sn
      }
    }
  }
  var bonusesByMonth = {}
  if (next.bonusesByMonth && typeof next.bonusesByMonth === 'object' && !Array.isArray(next.bonusesByMonth)) {
    for (var bkey in next.bonusesByMonth) {
      if (!next.bonusesByMonth.hasOwnProperty(bkey)) continue
      var monthObj = next.bonusesByMonth[bkey]
      if (!monthObj || typeof monthObj !== 'object' || Array.isArray(monthObj)) continue
      var cleanMonth = {}
      for (var empId in monthObj) {
        if (!monthObj.hasOwnProperty(empId)) continue
        var bn = Number(monthObj[empId])
        if (!isNaN(bn) && bn >= 0) cleanMonth[String(empId)] = bn
      }
      if (Object.keys(cleanMonth).length) bonusesByMonth[String(bkey)] = cleanMonth
    }
  }
  const safe = {
    defaultStart: String(next.defaultStart || '09:00').trim() || '09:00',
    defaultEnd: String(next.defaultEnd || '23:00').trim() || '23:00',
    employees: Array.isArray(next.employees)
      ? next.employees.map(function (e) {
          var rates = Array.isArray(e.rateHistory)
            ? e.rateHistory
                .map(function (r) {
                  var from = String((r && r.from) || '').trim()
                  var toRaw = r && r.to != null ? String(r.to).trim() : ''
                  var to = toRaw || ''
                  var modeRaw = String((r && r.mode) || '').trim()
                  var mode = modeRaw === 'from' || modeRaw === 'day' || modeRaw === 'period' ? modeRaw : ''
                  var rate = Number(r && r.rate)
                  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(from)) return null
                  if (to && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(to)) return null
                  if (to && to < from) to = from
                  if (isNaN(rate) || rate < 0) return null
                  if (!mode) {
                    if (!to) mode = 'from'
                    else if (to === from) mode = 'day'
                    else mode = 'period'
                  }
                  if (mode === 'from') to = ''
                  if (mode === 'day') to = from
                  if (mode === 'period' && !to) to = from
                  return { from: from, to: to || null, mode: mode, rate: Math.round(rate) }
                })
                .filter(Boolean)
            : []
          return {
            id: String(e.id || '').trim() || Utilities.getUuid(),
            name: String(e.name || '').trim() || 'Без имени',
            color: String(e.color || '#f0d4cf').trim(),
            hourlyRate: Number(e.hourlyRate) >= 0 ? Number(e.hourlyRate) : 0,
            rateHistory: rates,
          }
        })
      : [],
    employeesByMonth:
      next.employeesByMonth && typeof next.employeesByMonth === 'object' && !Array.isArray(next.employeesByMonth)
        ? next.employeesByMonth
        : {},
    shifts: Array.isArray(next.shifts)
      ? next.shifts.map(function (s) {
          return {
            id: String(s.id || '').trim() || Utilities.getUuid(),
            date: String(s.date || '').trim(),
            employeeId: String(s.employeeId || '').trim(),
            start: s.start ? String(s.start).trim() : '',
            end: s.end ? String(s.end).trim() : '',
          }
        })
      : [],
  }
  safe.shifts = safe.shifts.filter(function (s) {
    return s.date && s.employeeId
  })

  const monthKeys = {}
  safe.shifts.forEach(function (s) {
    var mk = monthKeyFromShiftDate_(s.date)
    if (mk) monthKeys[mk] = true
  })
  for (var sk in shortageByMonth) {
    if (shortageByMonth.hasOwnProperty(sk)) monthKeys[String(sk)] = true
  }
  for (var bk in bonusesByMonth) {
    if (bonusesByMonth.hasOwnProperty(bk)) monthKeys[String(bk)] = true
  }
  for (var emk in safe.employeesByMonth) {
    if (safe.employeesByMonth.hasOwnProperty(emk)) monthKeys[String(emk)] = true
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  const globalSheet = getScheduleSheet_(ss)
  const globalPayload = {
    defaultStart: safe.defaultStart,
    defaultEnd: safe.defaultEnd,
    employees: [],
    employeesByMonth: {},
    shifts: [],
    shortageByMonth: {},
    bonusesByMonth: {},
  }
  globalSheet.getRange(1, 1).setValue(JSON.stringify(globalPayload))

  for (var mk in monthKeys) {
    if (!monthKeys.hasOwnProperty(mk)) continue
    var monthShifts = safe.shifts.filter(function (s) {
      return monthKeyFromShiftDate_(s.date) === mk
    })
    var sm = {}
    if (shortageByMonth[mk] !== undefined) sm[mk] = shortageByMonth[mk]
    var bm = {}
    if (bonusesByMonth[mk] && typeof bonusesByMonth[mk] === 'object' && !Array.isArray(bonusesByMonth[mk])) {
      bm[mk] = bonusesByMonth[mk]
    }
    var monthEmployeesRaw =
      safe.employeesByMonth[mk] && Array.isArray(safe.employeesByMonth[mk])
        ? safe.employeesByMonth[mk]
        : []
    var monthEmployees = monthEmployeesRaw.map(function (e) {
      var rates = Array.isArray(e.rateHistory)
        ? e.rateHistory
            .map(function (r) {
              var from = String((r && r.from) || '').trim()
              var toRaw = r && r.to != null ? String(r.to).trim() : ''
              var to = toRaw || ''
              var modeRaw = String((r && r.mode) || '').trim()
              var mode = modeRaw === 'from' || modeRaw === 'day' || modeRaw === 'period' ? modeRaw : ''
              var rate = Number(r && r.rate)
              if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(from)) return null
              if (to && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(to)) return null
              if (to && to < from) to = from
              if (isNaN(rate) || rate < 0) return null
              if (!mode) {
                if (!to) mode = 'from'
                else if (to === from) mode = 'day'
                else mode = 'period'
              }
              if (mode === 'from') to = ''
              if (mode === 'day') to = from
              if (mode === 'period' && !to) to = from
              return { from: from, to: to || null, mode: mode, rate: Math.round(rate) }
            })
            .filter(Boolean)
        : []
      return {
        id: String(e.id || '').trim() || Utilities.getUuid(),
        name: String(e.name || '').trim() || 'Без имени',
        color: String(e.color || '#f0d4cf').trim(),
        hourlyRate: Number(e.hourlyRate) >= 0 ? Number(e.hourlyRate) : 0,
        rateHistory: rates,
      }
    })
    writeMonthScheduleSheet_(ss, mk, {
      employees: monthEmployees,
      shifts: monthShifts,
      shortageByMonth: sm,
      bonusesByMonth: bm,
    })
  }

  var toDelete = []
  ss.getSheets().forEach(function (sh) {
    var nm = sh.getName()
    if (!isScheduleMonthSheetName_(nm)) return
    var mkey = nm.substring(SCHEDULE_MONTH_PREFIX.length)
    if (!monthKeys[mkey]) toDelete.push(sh)
  })
  toDelete.forEach(function (sh) {
    ss.deleteSheet(sh)
  })

  return jsonResponse({ success: true })
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  )
}
