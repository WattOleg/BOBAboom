import { useEffect, useMemo, useState } from 'react'
import supabase, { getSession } from './api/supabaseClient'
import ListView from './components/ListView'
import DetailView from './components/DetailView'
import EditOverlay from './components/EditOverlay'
import AuthGate from './components/AuthGate'
import { useCards } from './hooks/useCards'
import {
  createCard,
  deleteCard,
  fetchCardDetail,
  fetchSchedule,
  fetchSectionsContent,
  fetchWriteoffs,
  fetchStopList,
  mutateWriteoffs,
  mutateStopList,
  syncWriteoffsOfflineCache,
  updateCard,
  updateSchedule,
  updateSectionContent,
} from './api/sheets'
import { exportAllCardsToPdf, exportCardToPdf, shareCardPdf } from './utils/pdfExport'
import { normalizePhotoUrl } from './utils/photoUrl'

function makeEmptyCard() {
  const today = new Date().toISOString().slice(0, 10)
  return {
    sheetName: '',
    name: '',
    nameRu: '',
    category: '',
    yield: '',
    time: '',
    method: '',
    glass: '',
    garnish: '',
    photoUrl: '',
    author: '',
    date: today,
    technology: '',
    ingredients: [{ name: '', amount: '' }],
  }
}

const CATEGORY_PRIORITY = ['Кофе', 'Матча', 'Чай листовой', 'Чай авторский', 'Лимонад']
const APP_SECTIONS = [
  { id: 'techcards', label: 'ТехКарты' },
  { id: 'schedule', label: 'График смен' },
  { id: 'writeoffs', label: 'Списания' },
  { id: 'regulations', label: 'Регламенты' },
  { id: 'appearance', label: 'Требования к внешнему виду' },
  { id: 'behavior', label: 'Поведение' },
  { id: 'rights', label: 'Права и ответственность' },
]

const DEFAULT_SCHEDULE = {
  defaultStart: '09:00',
  defaultEnd: '23:00',
  employees: [],
  employeesByMonth: {},
  shifts: [],
  shortageByMonth: {},
  bonusesByMonth: {},
}

function normalizeScheduleServer(s) {
  const raw = s && typeof s === 'object' ? s : {}
  const rawShifts = Array.isArray(raw.shifts) ? raw.shifts : []
  const shortageByMonth =
    raw.shortageByMonth && typeof raw.shortageByMonth === 'object' && !Array.isArray(raw.shortageByMonth)
      ? { ...raw.shortageByMonth }
      : {}
  const bonusesByMonth =
    raw.bonusesByMonth && typeof raw.bonusesByMonth === 'object' && !Array.isArray(raw.bonusesByMonth)
      ? { ...raw.bonusesByMonth }
      : {}
  const employeesByMonth =
    raw.employeesByMonth && typeof raw.employeesByMonth === 'object' && !Array.isArray(raw.employeesByMonth)
      ? { ...raw.employeesByMonth }
      : {}
  return {
    ...DEFAULT_SCHEDULE,
    ...raw,
    employees: Array.isArray(raw.employees) ? raw.employees : [],
    shifts: rawShifts.map((sh, i) => ({
      ...sh,
      id:
        sh.id && String(sh.id).trim()
          ? String(sh.id).trim()
          : `mig_${i}_${sh.date}_${sh.employeeId}_${sh.start || ''}_${sh.end || ''}`,
    })),
    shortageByMonth,
    bonusesByMonth,
    employeesByMonth,
  }
}
const DEFAULT_SECTION_CONTENT = {
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

const VISIT_EVENT = 'app-visit-count'
const DEFAULT_WRITEOFFS = { entries: [], templates: [] }
const DEFAULT_STOP_LIST = []

function App() {
  const { cards, loading, error, refresh, addLocalCard, updateLocalCard, removeLocalCard } = useCards()
  const [visitCount, setVisitCount] = useState(null)
  const [view, setView] = useState('list')
  const [selectedId, setSelectedId] = useState(null)
  const [editOpen, setEditOpen] = useState(false)
  const [authUser, setAuthUser] = useState(null)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState(null)
  const [draftCard, setDraftCard] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [activeSection, setActiveSection] = useState('techcards')
  const [sectionContent, setSectionContent] = useState(DEFAULT_SECTION_CONTENT)
  const [sectionEditor, setSectionEditor] = useState({ open: false, sectionId: null, text: '' })
  const [sectionSaving, setSectionSaving] = useState(false)
  const [sectionSaveError, setSectionSaveError] = useState('')
  const [scheduleData, setScheduleData] = useState(DEFAULT_SCHEDULE)
  const [scheduleUnlocked, setScheduleUnlocked] = useState(false)
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [scheduleSaveError, setScheduleSaveError] = useState('')
  const [scheduleLoadError, setScheduleLoadError] = useState('')
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [scheduleBaseline, setScheduleBaseline] = useState('')
  const [scheduleSavedAt, setScheduleSavedAt] = useState('')
  const [writeoffsData, setWriteoffsData] = useState(DEFAULT_WRITEOFFS)
  const [writeoffsLoading, setWriteoffsLoading] = useState(false)
  const [writeoffsSaving, setWriteoffsSaving] = useState(false)
  const [writeoffsSaveError, setWriteoffsSaveError] = useState('')
  const [stopListData, setStopListData] = useState(DEFAULT_STOP_LIST)
  const [stopListLoading, setStopListLoading] = useState(false)
  const [stopListSaving, setStopListSaving] = useState(false)
  const [stopListError, setStopListError] = useState('')

  const selectedCard = useMemo(
    () => cards.find((card) => card.sheetName === selectedId) || null,
    [cards, selectedId],
  )
  const scheduleSerialized = useMemo(() => JSON.stringify(scheduleData), [scheduleData])
  const scheduleDirty = Boolean(scheduleBaseline) && scheduleSerialized !== scheduleBaseline
  const categories = useMemo(
    () => {
      const unique = [...new Set(cards.map((card) => String(card.category || '').trim()).filter(Boolean))]
      const inPriority = CATEGORY_PRIORITY.filter((name) => unique.includes(name))
      const rest = unique.filter((name) => !CATEGORY_PRIORITY.includes(name))
      return [...inPriority, ...rest]
    },
    [cards],
  )

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const sharedSections = await fetchSectionsContent()
        if (!active) return
        setSectionContent({ ...DEFAULT_SECTION_CONTENT, ...sharedSections })
      } catch {
        // Keep local defaults when server sections are not available.
      }
    })()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        setStopListLoading(true)
        setStopListError('')
        const data = await fetchStopList()
        if (!active) return
        setStopListData(Array.isArray(data) ? data : [])
      } catch (err) {
        if (active) setStopListError(err.message || 'Не удалось загрузить стоп-лист')
      } finally {
        if (active) setStopListLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        setWriteoffsLoading(true)
        setWriteoffsSaveError('')
        const data = await fetchWriteoffs()
        if (!active) return
        setWriteoffsData({
          entries: Array.isArray(data?.entries) ? data.entries : [],
          templates: Array.isArray(data?.templates) ? data.templates : [],
        })
      } catch (err) {
        if (active) setWriteoffsSaveError(err.message || 'Не удалось загрузить списания')
      } finally {
        if (active) setWriteoffsLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        setScheduleLoading(true)
        setScheduleLoadError('')
        const s = await fetchSchedule()
        if (!active) return
        const normalized = normalizeScheduleServer(s)
        setScheduleData(normalized)
        setScheduleBaseline(JSON.stringify(normalized))
        setScheduleSavedAt('')
      } catch (err) {
        if (active) setScheduleLoadError(err.message || 'Не удалось загрузить график')
      } finally {
        if (active) setScheduleLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (activeSection !== 'schedule') setScheduleUnlocked(false)
  }, [activeSection])

  useEffect(() => {
    const onVisit = (e) => {
      if (typeof e.detail === 'number' && !Number.isNaN(e.detail)) setVisitCount(e.detail)
    }
    window.addEventListener(VISIT_EVENT, onVisit)
    return () => window.removeEventListener(VISIT_EVENT, onVisit)
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const session = await getSession()
        if (!mounted) return
        if (session && session.user) {
          setAuthUser({ id: session.user.id, email: session.user.email || null, phone: session.user.phone || null })
        }
      } catch {
        // ignore
      }
    })()

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && session.user) {
        setAuthUser({ id: session.user.id, email: session.user.email || null, phone: session.user.phone || null })
      } else {
        setAuthUser(null)
      }
    })

    return () => {
      mounted = false
      if (listener && typeof listener.unsubscribe === 'function') listener.unsubscribe()
    }
  }, [])

  const ensureFullCard = async (card) => {
    if (!card || !card.isPartial) return card
    const detailed = await fetchCardDetail(card.sheetName)
    if (detailed) {
      updateLocalCard(detailed)
      return detailed
    }
    return card
  }

  const exportSelectedCards = async (sheetNames) => {
    const selected = cards.filter((card) => sheetNames.includes(card.sheetName))
    if (selected.length === 0) return
    const fullCards = await Promise.all(selected.map((card) => ensureFullCard(card)))
    await exportAllCardsToPdf(fullCards)
  }

  const exportOneCard = async () => {
    if (!selectedCard) return
    const fullCard = await ensureFullCard(selectedCard)
    await exportCardToPdf(fullCard)
  }

  const shareOneCard = async () => {
    if (!selectedCard) return
    const fullCard = await ensureFullCard(selectedCard)
    await shareCardPdf(fullCard)
  }

  const openDetail = async (cardId) => {
    setSelectedId(cardId)
    setView('detail')
    const base = cards.find((card) => card.sheetName === cardId)
    if (base?.isPartial) {
      setDetailLoading(true)
      try {
        const detailed = await fetchCardDetail(cardId)
        if (detailed) updateLocalCard(detailed)
      } finally {
        setDetailLoading(false)
      }
    }
  }

  const closeDetail = () => {
    setView('list')
    setEditOpen(false)
  }

  const requestAction = (action) => {
    if (!authUser) {
      setPendingAction(action)
      setAuthModalOpen(true)
      return
    }
    void performAction(action)
  }

  const requestSectionEdit = (sectionId) => {
    if (!authUser) {
      setPendingAction({ type: 'editSection', sectionId })
      setAuthModalOpen(true)
      return
    }
    const current = sectionId ? sectionContent[sectionId] : null
    if (sectionId && current) {
      setSectionEditor({
        open: true,
        sectionId,
        text: current.points.join('\n'),
      })
      setSectionSaveError('')
    }
  }

  const requestScheduleUnlock = () => {
    if (!authUser) {
      setPendingAction({ type: 'scheduleUnlock' })
      setAuthModalOpen(true)
      return
    }
    setScheduleUnlocked(true)
  }

  const closeAuthModal = () => {
    setAuthModalOpen(false)
    setPendingAction(null)
  }

  const handleAuthSuccess = (user) => {
    setAuthUser(user)
    setAuthModalOpen(false)
    if (pendingAction) {
      const action = pendingAction
      setPendingAction(null)
      void performAction(action)
    }
  }

  const performAction = async (action) => {
    if (!action) return
    if (action === 'create') {
      setDraftCard(makeEmptyCard())
      setEditOpen(true)
      return
    }
    if (action === 'edit') {
      if (!selectedCard) return
      setDraftCard(null)
      setEditOpen(true)
      return
    }
    if (action === 'delete') {
      if (!selectedCard) return
      try {
        await deleteCard(selectedCard.sheetName, import.meta.env.VITE_PIN_CODE)
        removeLocalCard(selectedCard.sheetName)
        closeDetail()
      } catch (err) {
        console.error(err)
      }
      return
    }
    if (action?.type === 'editSection') {
      const sectionId = action.sectionId
      const current = sectionId ? sectionContent[sectionId] : null
      if (sectionId && current) {
        setSectionEditor({
          open: true,
          sectionId,
          text: current.points.join('\n'),
        })
        setSectionSaveError('')
      }
      return
    }
    if (action?.type === 'scheduleUnlock') {
      setScheduleUnlocked(true)
    }
  }

  const onSaveEdit = async (nextCard) => {
    const preparedCard = { ...nextCard, photoUrl: normalizePhotoUrl(nextCard.photoUrl) }
    const isCreate = !selectedCard || draftCard !== null

    if (isCreate) {
      if (!preparedCard.sheetName.trim()) {
        throw new Error('Заполните идентификатор листа (sheetName)')
      }
      await createCard(preparedCard, import.meta.env.VITE_PIN_CODE)
      addLocalCard(preparedCard)
      setSelectedId(preparedCard.sheetName)
      setView('detail')
      setDraftCard(null)
    } else {
      await updateCard(preparedCard.sheetName, preparedCard, import.meta.env.VITE_PIN_CODE)
      updateLocalCard(preparedCard)
    }
    setEditOpen(false)
  }

  const saveSectionEditor = async () => {
    const sectionId = sectionEditor.sectionId
    if (!sectionId) return
    const points = sectionEditor.text
      .split(/\r\n|\n|\r/)
      .map((line) => line.replace(/\u00a0/g, ' ').trim())
      .filter(Boolean)
    const safePoints = points.length ? points : ['Добавьте первый пункт.']
    const next = {
      ...sectionContent,
      [sectionId]: {
        ...sectionContent[sectionId],
        points: safePoints,
      },
    }
    try {
      setSectionSaving(true)
      setSectionSaveError('')
      await updateSectionContent(
        sectionId,
        sectionContent[sectionId]?.title || sectionId,
        safePoints,
        import.meta.env.VITE_PIN_CODE,
      )
      setSectionContent(next)
      setSectionEditor({ open: false, sectionId: null, text: '' })
    } catch (err) {
      setSectionSaveError(err.message || 'Не удалось сохранить раздел')
    } finally {
      setSectionSaving(false)
    }
  }

  const saveScheduleToSheet = async () => {
    try {
      setScheduleSaving(true)
      setScheduleSaveError('')
      await updateSchedule(scheduleData, import.meta.env.VITE_PIN_CODE)
      const fresh = await fetchSchedule()
      const normalized = normalizeScheduleServer(fresh)
      setScheduleData(normalized)
      setScheduleBaseline(JSON.stringify(normalized))
      setScheduleSavedAt(new Date().toISOString())
    } catch (err) {
      setScheduleSaveError(err.message || 'Ошибка сохранения графика')
    } finally {
      setScheduleSaving(false)
    }
  }

  const writeoffsPin = import.meta.env.VITE_PIN_CODE

  const reloadWriteoffsFromSheet = async () => {
    const fresh = await fetchWriteoffs()
    setWriteoffsData({
      entries: Array.isArray(fresh?.entries) ? fresh.entries : [],
      templates: Array.isArray(fresh?.templates) ? fresh.templates : [],
    })
  }

  const runWriteoffMutation = async (payload) => {
    setWriteoffsSaving(true)
    setWriteoffsSaveError('')
    try {
      await mutateWriteoffs(payload, writeoffsPin)
      try {
        await reloadWriteoffsFromSheet()
      } catch (reloadErr) {
        if (payload.op === 'append' && payload.entry) {
          setWriteoffsData((prev) => {
            const list = Array.isArray(prev.entries) ? prev.entries : []
            const entry = payload.entry
            const next = {
              templates: Array.isArray(prev.templates) ? prev.templates : [],
              entries: [entry, ...list.filter((e) => e.id !== entry.id)],
            }
            syncWriteoffsOfflineCache(next)
            return next
          })
          setWriteoffsSaveError(
            reloadErr.message ||
              'Строка записана в таблицу, но список не удалось обновить. Проверьте сеть и нажмите «Обновить из таблицы».',
          )
          return
        }
        if (payload.op === 'templates' && Array.isArray(payload.templates)) {
          setWriteoffsData((prev) => {
            const next = {
              entries: Array.isArray(prev.entries) ? prev.entries : [],
              templates: payload.templates.map((t) => ({ ...t })),
            }
            syncWriteoffsOfflineCache(next)
            return next
          })
          setWriteoffsSaveError(
            reloadErr.message ||
              'Шаблоны записаны в таблицу, но список не удалось обновить. Нажмите «Обновить из таблицы».',
          )
          return
        }
        throw reloadErr
      }
    } catch (err) {
      setWriteoffsSaveError(err.message || 'Ошибка сохранения списаний')
      throw err
    } finally {
      setWriteoffsSaving(false)
    }
  }

  const refreshWriteoffsOnly = async () => {
    try {
      setWriteoffsSaving(true)
      setWriteoffsSaveError('')
      await reloadWriteoffsFromSheet()
    } catch (err) {
      setWriteoffsSaveError(err.message || 'Не удалось обновить списания')
      throw err
    } finally {
      setWriteoffsSaving(false)
    }
  }

  const reloadStopList = async () => {
    const fresh = await fetchStopList()
    setStopListData(Array.isArray(fresh) ? fresh : [])
  }

  const runStopListMutation = async (payload) => {
    setStopListSaving(true)
    setStopListError('')
    try {
      await mutateStopList(payload)
      await reloadStopList()
    } catch (err) {
      setStopListError(err.message || 'Ошибка сохранения стоп-листа')
      throw err
    } finally {
      setStopListSaving(false)
    }
  }

  return (
    <div className="app-shell">
      <div className={`screen-stack view-${view}`}>
        <section className="screen screen-list" aria-hidden={view !== 'list'}>
          <ListView
            cards={cards}
            categories={categories}
            visitCount={visitCount}
            loading={loading}
            error={error}
            activeSection={activeSection}
            sections={APP_SECTIONS}
            sectionContent={sectionContent}
            onSectionChange={setActiveSection}
            onSectionEdit={requestSectionEdit}
            onSelect={openDetail}
            onRefresh={refresh}
            onExportSelected={exportSelectedCards}
            onCreate={() => requestAction('create')}
            stopList={{
              data: stopListData,
              loading: stopListLoading,
              saving: stopListSaving,
              error: stopListError,
              onReload: async () => {
                try {
                  setStopListLoading(true)
                  setStopListError('')
                  await reloadStopList()
                } catch (err) {
                  setStopListError(err.message || 'Не удалось обновить стоп-лист')
                } finally {
                  setStopListLoading(false)
                }
              },
              onAdd: (entry) => runStopListMutation({ op: 'append', entry }),
              onDelete: (id) => runStopListMutation({ op: 'delete', id }),
            }}
            schedule={
              activeSection === 'schedule'
                ? {
                    data: scheduleData,
                    onChange: setScheduleData,
                    canEdit: scheduleUnlocked,
                    onRequestUnlock: requestScheduleUnlock,
                    onExitEdit: () => setScheduleUnlocked(false),
                    onSave: saveScheduleToSheet,
                    saving: scheduleSaving,
                    loading: scheduleLoading,
                    saveError: scheduleSaveError,
                    loadError: scheduleLoadError,
                    saveState: { dirty: scheduleDirty, savedAt: scheduleSavedAt },
                    onReload: async () => {
                      try {
                        setScheduleLoading(true)
                        setScheduleLoadError('')
                        const s = await fetchSchedule()
                        const normalized = normalizeScheduleServer(s)
                        setScheduleData(normalized)
                        setScheduleBaseline(JSON.stringify(normalized))
                      } catch (e) {
                        setScheduleLoadError(e.message || 'Не удалось обновить график')
                      } finally {
                        setScheduleLoading(false)
                      }
                    },
                  }
                : null
            }
            writeoffs={
              activeSection === 'writeoffs'
                ? {
                    data: writeoffsData,
                    onReload: refreshWriteoffsOnly,
                    onAppendEntry: (entry) => runWriteoffMutation({ op: 'append', entry }),
                    onDeleteEntry: (id) => runWriteoffMutation({ op: 'delete', id }),
                    onUpdateEntry: (entry) => runWriteoffMutation({ op: 'update', entry }),
                    onReplaceTemplates: (templates) => runWriteoffMutation({ op: 'templates', templates }),
                    loading: writeoffsLoading,
                    saving: writeoffsSaving,
                    saveError: writeoffsSaveError,
                    onClearSaveError: () => setWriteoffsSaveError(''),
                  }
                : null
            }
          />
        </section>
        <section className="screen screen-detail" aria-hidden={view !== 'detail'}>
          <DetailView
            card={selectedCard}
            loading={detailLoading}
            onBack={closeDetail}
            onEdit={() => requestAction('edit')}
            onDelete={() => requestAction('delete')}
            onExport={exportOneCard}
            onShare={shareOneCard}
          />
        </section>
      </div>

      <EditOverlay
        isOpen={editOpen}
        card={draftCard || selectedCard}
        categories={categories}
        onClose={() => {
          setEditOpen(false)
          setDraftCard(null)
        }}
        onSave={onSaveEdit}
      />

      <AuthGate isOpen={authModalOpen} title="Доступ в BB" onClose={closeAuthModal} onSuccess={handleAuthSuccess} />

      {sectionEditor.open ? (
        <div className="export-modal-backdrop" onClick={() => setSectionEditor({ open: false, sectionId: null, text: '' })}>
          <div className="export-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Редактирование раздела</h3>
            <p className="muted section-editor-hint">
              Каждая строка — отдельный абзац (без автонумерации). Заголовки: <code>#</code>, <code>##</code>,{' '}
              <code>###</code> в начале строки; можно <code>#2. Подзаголовок</code>. Списки: строки с{' '}
              <code>-</code>, <code>*</code> или <code>•</code>. Разделитель: <code>---</code>. Примечание:{' '}
              <code>&gt; текст</code>. В строке: <code>**жирный**</code>, <code>__жирный__</code>,{' '}
              <code>_курсив_</code>. Свой текст <code>1. 2.</code> остаётся как вы написали.
            </p>
            <textarea
              className="section-editor-textarea"
              value={sectionEditor.text}
              onChange={(e) => setSectionEditor((prev) => ({ ...prev, text: e.target.value }))}
            />
            <div className="export-actions">
              <button
                type="button"
                className="ghost-btn"
                disabled={sectionSaving}
                onClick={() => setSectionEditor({ open: false, sectionId: null, text: '' })}
              >
                Отмена
              </button>
              <button type="button" className="btn btn-dark" onClick={saveSectionEditor} disabled={sectionSaving}>
                {sectionSaving ? 'Сохраняю...' : 'Сохранить'}
              </button>
            </div>
            {sectionSaveError ? <p className="error">{sectionSaveError}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App
