import { formatWriteoffDateRuFromEntry } from './writeoffDateRu'

const toText = (value) => String(value || '').trim()

let pdfMakePromise = null
const ROBOTO_REGULAR = 'Roboto-Regular.ttf'

function registerVfs(pdfMake, vfs) {
  if (!vfs) return
  if (typeof pdfMake.addVirtualFileSystem === 'function') {
    pdfMake.addVirtualFileSystem(vfs)
    return
  }
  pdfMake.vfs = { ...(pdfMake.vfs || {}), ...vfs }
}

function hasRobotoInVfs(pdfMake) {
  return Boolean(pdfMake?.vfs?.[ROBOTO_REGULAR])
}

async function getPdfMake() {
  if (!pdfMakePromise) {
    pdfMakePromise = (async () => {
      const pdfMakeModule = await import('pdfmake/build/pdfmake')
      const pdfMake = pdfMakeModule.default || pdfMakeModule

      // vfs_fonts in some builds patches global pdfMake as a side effect.
      globalThis.pdfMake = pdfMake
      const pdfFontsModule = await import('pdfmake/build/vfs_fonts')

      const mod = pdfFontsModule?.default || pdfFontsModule
      const moduleVfs = mod?.pdfMake?.vfs || mod?.vfs || null
      registerVfs(pdfMake, moduleVfs)

      const hasVirtualFsApi = typeof pdfMake.addVirtualFileSystem === 'function'
      if (!hasVirtualFsApi && !hasRobotoInVfs(pdfMake)) {
        throw new Error('Не удалось загрузить шрифты PDF (vfs)')
      }

      return pdfMake
    })()
  }
  return pdfMakePromise
}

function cardToContent(card) {
  const ingredientsRows = (card.ingredients || []).map((item) => [
    { text: toText(item.name), margin: [0, 4, 0, 4] },
    { text: toText(item.amount), alignment: 'right', margin: [0, 4, 0, 4] },
  ])
  const safeRows =
    ingredientsRows.length > 0
      ? ingredientsRows
      : [[{ text: '-', margin: [0, 4, 0, 4] }, { text: '-', alignment: 'right', margin: [0, 4, 0, 4] }]]

  return [
    { text: 'ТЕХНОЛОГИЧЕСКАЯ КАРТА', style: 'title' },
    {
      columns: [
        [
          { text: `Введено с «${toText(card.date)}г.»`, style: 'meta' },
          { text: `Наименование блюда: ${toText(card.name)}`, style: 'meta' },
          { text: `Наименование RU: ${toText(card.nameRu)}`, style: 'meta' },
          { text: `Категория: ${toText(card.category)}`, style: 'meta' },
          { text: `Время приготовления: ${toText(card.time)}`, style: 'meta' },
        ],
      ],
      margin: [0, 0, 0, 10],
    },
    {
      table: {
        widths: ['*', 120, '*'],
        body: [
          [
            { text: 'Сырье', style: 'headCell' },
            { text: 'Расход на 1 порцию', style: 'headCell' },
            { text: 'Технология приготовления', style: 'headCell' },
          ],
          ...safeRows.map((row, index) => [
            row[0],
            row[1],
            index === 0
              ? { text: toText(card.technology), rowSpan: safeRows.length, margin: [0, 4, 0, 4] }
              : {},
          ]),
          [
            { text: 'Выход:', style: 'footCell' },
            { text: toText(card.yield), style: 'footCell', alignment: 'right' },
            { text: '', style: 'footCell' },
          ],
          [
            { text: `Разработал: ${toText(card.author)}`, colSpan: 3, style: 'footCell' },
            {},
            {},
          ],
        ],
      },
      layout: {
        hLineWidth: () => 0.8,
        vLineWidth: () => 0.8,
        hLineColor: () => '#333',
        vLineColor: () => '#333',
      },
    },
  ]
}

function baseDocDefinition(content) {
  return {
    pageSize: 'A4',
    pageMargins: [28, 24, 28, 24],
    content,
    defaultStyle: {
      fontSize: 11,
    },
    styles: {
      title: {
        fontSize: 14,
        bold: true,
        margin: [0, 0, 0, 10],
      },
      subtitle: {
        fontSize: 12,
        bold: true,
        margin: [0, 12, 0, 6],
      },
      meta: {
        margin: [0, 0, 0, 4],
      },
      headCell: {
        bold: true,
        fillColor: '#f3f3f3',
        margin: [0, 4, 0, 4],
      },
      footCell: {
        bold: true,
        margin: [0, 4, 0, 4],
      },
    },
  }
}

const pdfTableLayout = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => '#ccc',
  vLineColor: () => '#ccc',
}

/**
 * @typedef {Object} SchedulePdfPayload
 * @property {string} title — например «март 2026 г.»
 * @property {string} filenameStem — «2026-03»
 * @property {{ label: string, shiftsText: string }[]} calendarRows
 * @property {{ rows: { name: string, hours: string|number, gross: number, net: number }[], totalHours: string|number, totalGross: number, shortage: number, netPay: number }} summary
 */

function scheduleToPdfContent(payload) {
  const generated = new Date().toLocaleString('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  })

  const calendarBody = [
    [
      { text: 'Дата', style: 'headCell' },
      { text: 'Смены', style: 'headCell' },
    ],
    ...payload.calendarRows.map((row) => [
      { text: row.label, margin: [4, 3, 4, 3] },
      {
        text: row.shiftsText,
        margin: [4, 3, 4, 3],
        color: row.shiftsText === '—' ? '#888' : undefined,
      },
    ]),
  ]

  const summary = payload.summary
  const blocks = [
    { text: 'ГРАФИК СМЕН', style: 'title' },
    { text: toText(payload.title), style: 'meta', bold: true, fontSize: 12 },
    { text: `Сформировано: ${generated}`, style: 'meta', fontSize: 9, color: '#555' },
    { text: 'Календарь', style: 'subtitle' },
    {
      table: {
        widths: [78, '*'],
        dontBreakRows: false,
        body: calendarBody,
      },
      layout: pdfTableLayout,
    },
  ]

  if (summary) {
    const summaryBody = [
    [
      { text: 'Сотрудник', style: 'headCell' },
      { text: 'Часы', style: 'headCell', alignment: 'right' },
      { text: 'Начислено, ₸', style: 'headCell', alignment: 'right' },
      { text: 'К выплате, ₸', style: 'headCell', alignment: 'right' },
    ],
    ...summary.rows.map((r) => [
      { text: toText(r.name), margin: [2, 3, 2, 3] },
      { text: `${r.hours} ч`, alignment: 'right', margin: [2, 3, 2, 3] },
      { text: String(r.gross), alignment: 'right', margin: [2, 3, 2, 3] },
      { text: String(r.net), bold: true, alignment: 'right', margin: [2, 3, 2, 3] },
    ]),
    [
      { text: 'Всего часов', style: 'footCell', colSpan: 2 },
      {},
      { text: `${summary.totalHours} ч`, style: 'footCell', alignment: 'right' },
      { text: '', style: 'footCell' },
    ],
    [
      { text: 'Начислено всего', style: 'footCell', colSpan: 3 },
      {},
      {},
      { text: String(summary.totalGross), style: 'footCell', alignment: 'right' },
    ],
    [
      { text: 'Недостача за месяц', style: 'footCell', colSpan: 3 },
      {},
      {},
      { text: String(summary.shortage), style: 'footCell', alignment: 'right' },
    ],
    [
      { text: 'К выплате всего', style: 'footCell', colSpan: 3, fontSize: 12 },
      {},
      {},
      { text: String(summary.netPay), style: 'footCell', alignment: 'right', fontSize: 12 },
    ],
    ]
    blocks.push(
      { text: 'Итого за месяц', style: 'subtitle' },
      {
        table: {
          widths: ['*', 52, 64, 72],
          body: summaryBody,
        },
        layout: pdfTableLayout,
      },
    )
  }

  return blocks
}

function writeoffsToPdfContent(payload) {
  const parseQty = (value) => {
    const raw = String(value || '').replace(',', '.').replace(/[^0-9.\-]/g, '')
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  }
  const rows = (payload.entries || []).map((e) => [
    { text: toText(formatWriteoffDateRuFromEntry(e)), margin: [2, 3, 2, 3] },
    { text: toText(e.employee), margin: [2, 3, 2, 3] },
    { text: toText(e.type === 'move' ? 'Перемещение' : 'Списание'), margin: [2, 3, 2, 3] },
    { text: toText(e.item), margin: [2, 3, 2, 3] },
    { text: `${toText(e.qty)} ${toText(e.unit)}`.trim(), alignment: 'right', margin: [2, 3, 2, 3] },
    { text: toText(e.reason), margin: [2, 3, 2, 3] },
  ])
  const sumMap = new Map()
  ;(payload.entries || []).forEach((e) => {
    const item = toText(e.item)
    const unit = toText(e.unit) || 'шт'
    if (!item) return
    const key = `${item}__${unit}`
    const curr = sumMap.get(key) || { item, unit, writeoff: 0, move: 0 }
    const q = parseQty(e.qty)
    if ((e.type || '') === 'move') curr.move += q
    else curr.writeoff += q
    sumMap.set(key, curr)
  })
  const sumRows = Array.from(sumMap.values())
    .sort((a, b) => a.item.localeCompare(b.item))
    .map((r) => [
      { text: r.item, margin: [2, 3, 2, 3] },
      { text: `${r.writeoff.toFixed(2).replace(/\.00$/, '')} ${r.unit}`.trim(), alignment: 'right', margin: [2, 3, 2, 3] },
      { text: `${r.move.toFixed(2).replace(/\.00$/, '')} ${r.unit}`.trim(), alignment: 'right', margin: [2, 3, 2, 3] },
    ])
  return [
    { text: 'СПИСАНИЯ И ПЕРЕМЕЩЕНИЯ', style: 'title' },
    { text: `Сформировано: ${new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}`, style: 'meta' },
    {
      table: {
        headerRows: 1,
        widths: [56, 68, 70, '*', 56, 110],
        body: [
          [
            { text: 'Дата', style: 'headCell' },
            { text: 'Сотрудник', style: 'headCell' },
            { text: 'Тип', style: 'headCell' },
            { text: 'Продукт', style: 'headCell' },
            { text: 'Кол-во', style: 'headCell', alignment: 'right' },
            { text: 'Причина / Куда', style: 'headCell' },
          ],
          ...(rows.length
            ? rows
            : [[{ text: '—', colSpan: 6, alignment: 'center', margin: [0, 8, 0, 8] }, {}, {}, {}, {}, {}]]),
        ],
      },
      layout: pdfTableLayout,
    },
    { text: 'Итог по повторяющимся продуктам', style: 'subtitle' },
    {
      table: {
        headerRows: 1,
        widths: ['*', 100, 100],
        body: [
          [
            { text: 'Продукт', style: 'headCell' },
            { text: 'Списано', style: 'headCell', alignment: 'right' },
            { text: 'Перемещено', style: 'headCell', alignment: 'right' },
          ],
          ...(sumRows.length
            ? sumRows
            : [[{ text: '—', colSpan: 3, alignment: 'center', margin: [0, 8, 0, 8] }, {}, {}]]),
        ],
      },
      layout: pdfTableLayout,
    },
  ]
}

function isShareAbort(error) {
  if (!error) return false
  return error.name === 'AbortError'
}

function openBlobInNewTab(blobUrl) {
  const win = window.open(blobUrl, '_blank', 'noopener,noreferrer')
  return Boolean(win)
}

function forceDownloadFromBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function exportCardToPdf(card) {
  const pdfMake = await getPdfMake()
  const filename = `techcard-${toText(card.sheetName) || 'card'}.pdf`
  await new Promise((resolve) => {
    pdfMake.createPdf(baseDocDefinition(cardToContent(card))).download(filename, null, resolve)
  })
}

/** @param {SchedulePdfPayload} payload */
export async function exportScheduleToPdf(payload) {
  const pdfMake = await getPdfMake()
  const stem = toText(payload.filenameStem) || 'grafik'
  const filename = `grafik-smen-${stem}.pdf`
  const docDef = baseDocDefinition(scheduleToPdfContent(payload))
  await new Promise((resolve) => {
    pdfMake.createPdf(docDef).download(filename, null, resolve)
  })
}

export async function exportWriteoffsToPdf(payload) {
  const pdfMake = await getPdfMake()
  const filename = `spisaniya-${new Date().toISOString().slice(0, 10)}.pdf`
  await new Promise((resolve) => {
    pdfMake.createPdf(baseDocDefinition(writeoffsToPdfContent(payload))).download(filename, null, resolve)
  })
}

export async function exportAllCardsToPdf(cards) {
  const pdfMake = await getPdfMake()
  const content = cards.flatMap((card, idx) => {
    const block = cardToContent(card)
    if (idx < cards.length - 1) {
      block.push({ text: '', pageBreak: 'after' })
    }
    return block
  })
  const filename = `techcards-all-${new Date().toISOString().slice(0, 10)}.pdf`
  await new Promise((resolve) => {
    pdfMake.createPdf(baseDocDefinition(content)).download(filename, null, resolve)
  })
}

export async function shareCardPdf(card) {
  const pdfMake = await getPdfMake()
  const filename = `techcard-${toText(card.sheetName) || 'card'}.pdf`
  const pdfDoc = pdfMake.createPdf(baseDocDefinition(cardToContent(card)))
  const blob = await new Promise((resolve) => pdfDoc.getBlob(resolve))
  const file = new File([blob], filename, { type: 'application/pdf' })
  const title = toText(card.name) || 'Техкарта'
  const blobUrl = URL.createObjectURL(blob)

  try {
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      await navigator.share({ title, files: [file] })
      return
    }

    if (navigator.share) {
      try {
        await navigator.share({ title, url: blobUrl })
        return
      } catch (error) {
        if (!isShareAbort(error)) throw error
        return
      }
    }

    const opened = openBlobInNewTab(blobUrl)
    if (!opened) {
      forceDownloadFromBlob(blob, filename)
    }
  } catch (error) {
    if (isShareAbort(error)) return
    forceDownloadFromBlob(blob, filename)
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 15000)
  }
}
