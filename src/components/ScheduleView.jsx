import { useCallback, useEffect, useMemo, useState } from 'react'
import { verifyPayrollPin } from '../api/sheets'
import PayrollPinModal from './PayrollPinModal'
import { exportScheduleToPdf } from '../utils/pdfExport'
import {
  addDaysYmd,
  chipTextColors,
  formatRuDate,
  formatShiftRange,
  monthDateStrings,
  normalizeRateHistory,
  parseHexColor,
  rateForDate,
  shiftHours,
  timeToMinutes,
  weekdayShortRu,
} from '../utils/scheduleMath'

const PRESET_COLORS = ['#dbeafe', '#dbe7ff', '#bfdbfe', '#93c5fd', '#bae6fd', '#c7d2fe', '#dbeafe', '#bfdbfe']
const SHIFT_TEMPLATES = {
  morning: { label: 'Утро', start: '09:00', end: '17:00' },
  evening: { label: 'Вечер', start: '15:00', end: '23:00' },
  full: { label: 'Полная', start: '09:00', end: '23:00' },
}

/** Для старых записей без своих времён в JSON */
const LEGACY_START = '09:00'
const LEGACY_END = '23:00'

function newShiftId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `sh_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function newEmployeeId() {
  return `emp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** Суммы в тенге без копеек (для отображения) */
function tenge(n) {
  return Math.round(Number(n) || 0)
}

const PAYROLL_SESSION_KEY = 'tk_payroll_unlocked_v1'

function clearPayrollSession(monthKey) {
  try {
    const raw = sessionStorage.getItem(PAYROLL_SESSION_KEY)
    if (!raw) return
    const all = JSON.parse(raw)
    if (!all || typeof all !== 'object') return
    delete all[monthKey]
    sessionStorage.setItem(PAYROLL_SESSION_KEY, JSON.stringify(all))
  } catch {
    // ignore storage errors
  }
}

function softTint(hex, alpha = 0.2) {
  const rgb = parseHexColor(hex)
  if (!rgb) return '#f3f2ef'
  const a = Math.max(0, Math.min(1, alpha))
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`
}

function rateMode(row) {
  if (!row) return 'from'
  if (row.mode === 'from' || row.mode === 'day' || row.mode === 'period') return row.mode
  if (!row.to) return 'from'
  if (row.to === row.from) return 'day'
  return 'period'
}

function ToolbarIcon({ type }) {
  if (type === 'edit') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z" />
      </svg>
    )
  }
  if (type === 'refresh') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <polyline points="21 3 21 9 15 9" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function ScheduleView({
  data,
  onChange,
  canEdit,
  onRequestUnlock,
  onExitEdit,
  onSave,
  saving,
  loading,
  saveError,
  loadError,
  saveState,
  onReload,
  viewerEmail = '',
}) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [patternOpen, setPatternOpen] = useState(false)
  const [patternEmp, setPatternEmp] = useState('')
  const [patternStart, setPatternStart] = useState('')
  const [patternDays, setPatternDays] = useState(28)
  const [patternMode, setPatternMode] = useState('22')
  const [patternTemplate, setPatternTemplate] = useState('full')
  const [scheduleTab, setScheduleTab] = useState('calendar')
  const [calendarEmployeeFilter, setCalendarEmployeeFilter] = useState('')
  const [payrollEmployeeFilter, setPayrollEmployeeFilter] = useState('')
  const [payrollUnlocked, setPayrollUnlocked] = useState({})
  const [payrollPinModal, setPayrollPinModal] = useState({ open: false, employeeId: '', employeeName: '' })
  const normalizedViewerEmail = String(viewerEmail || '').trim().toLowerCase()
  const [payrollPinVerifying, setPayrollPinVerifying] = useState(false)
  const [dayModal, setDayModal] = useState(null)
  const [dayModalError, setDayModalError] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState('')
  const [toastText, setToastText] = useState('')
  const [isOnline, setIsOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)

  useEffect(() => {
    if (!toastText) return
    const t = setTimeout(() => setToastText(''), 1700)
    return () => clearTimeout(t)
  }, [toastText])
  useEffect(() => {
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const showToast = (text) => setToastText(String(text || ''))
  const statusSavedAt = saveState?.savedAt
    ? new Date(saveState.savedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : ''

  const dates = useMemo(() => monthDateStrings(year, month), [year, month])
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`

  const resetPayrollAccess = useCallback(() => {
    setPayrollUnlocked({})
    setPayrollEmployeeFilter('')
    setPayrollPinModal({ open: false, employeeId: '', employeeName: '' })
    clearPayrollSession(monthKey)
  }, [monthKey])

  useEffect(() => {
    resetPayrollAccess()
  }, [monthKey, resetPayrollAccess])

  useEffect(() => {
    if (scheduleTab !== 'payroll') {
      resetPayrollAccess()
    }
  }, [scheduleTab, resetPayrollAccess])
  const monthEmployees = useMemo(() => {
    const byMonth = data.employeesByMonth || {}
    const list = byMonth[monthKey]
    if (Array.isArray(list)) return list
    return []
  }, [data.employeesByMonth, monthKey])

  useEffect(() => {
    if (canEdit || !normalizedViewerEmail) return
    const matched = monthEmployees.find(
      (employee) => String(employee.email || '').trim().toLowerCase() === normalizedViewerEmail,
    )
    if (matched?.id) {
      setCalendarEmployeeFilter(matched.id)
    }
  }, [canEdit, monthEmployees, normalizedViewerEmail])

  const shiftsByDate = useMemo(() => {
    const map = new Map()
    ;(data.shifts || []).forEach((s) => {
      if (!s.date) return
      if (!map.has(s.date)) map.set(s.date, [])
      map.get(s.date).push(s)
    })
    map.forEach((list) => {
      list.sort(
        (a, b) =>
          timeToMinutes((a.start || LEGACY_START).trim() || LEGACY_START) -
          timeToMinutes((b.start || LEGACY_START).trim() || LEGACY_START),
      )
    })
    return map
  }, [data.shifts])

  const totals = useMemo(() => {
    const empById = new Map((monthEmployees || []).map((e) => [e.id, e]))
    const byEmp = {}
    ;(monthEmployees || []).forEach((e) => {
      byEmp[e.id] = { hours: 0, pay: 0 }
    })
    ;(data.shifts || []).forEach((s) => {
      if (!dates.includes(s.date)) return
      if (!byEmp[s.employeeId]) {
        byEmp[s.employeeId] = { hours: 0, pay: 0 }
      }
      const emp = empById.get(s.employeeId) || { hourlyRate: 0, rateHistory: [] }
      const h = shiftHours(s, LEGACY_START, LEGACY_END)
      const rate = rateForDate(s.date, emp)
      byEmp[s.employeeId].hours += h
      byEmp[s.employeeId].pay += h * rate
    })
    Object.keys(byEmp).forEach((id) => {
      const t = byEmp[id]
      t.pay = Math.round(t.pay)
    })
    return byEmp
  }, [data.shifts, monthEmployees, dates])

  const grandTotal = useMemo(() => {
    let pay = 0
    let hours = 0
    Object.values(totals).forEach((t) => {
      pay += t.pay
      hours += t.hours
    })
    return { pay: tenge(pay), hours: Math.round(hours * 100) / 100 }
  }, [totals])

  const shortageMap = data.shortageByMonth || {}
  const hasShortageKey = Object.prototype.hasOwnProperty.call(shortageMap, monthKey)
  const rawMonthShortage = shortageMap[monthKey]
  const monthShortageEntries = useMemo(() => {
    if (rawMonthShortage && typeof rawMonthShortage === 'object' && !Array.isArray(rawMonthShortage)) {
      return Object.fromEntries(
        Object.entries(rawMonthShortage).map(([employeeId, value]) => [employeeId, tenge(Math.max(0, Number(value) || 0))]),
      )
    }

    const fallbackTotal = tenge(Math.max(0, Number(rawMonthShortage) || 0))
    const employees = monthEmployees || []
    if (!employees.length) return {}
    const perEmployee = fallbackTotal / employees.length
    return Object.fromEntries(employees.map((employee) => [employee.id, tenge(perEmployee)]))
  }, [monthEmployees, rawMonthShortage])
  const bonusesByMonth = data.bonusesByMonth || {}
  const monthBonuses =
    bonusesByMonth[monthKey] && typeof bonusesByMonth[monthKey] === 'object' && !Array.isArray(bonusesByMonth[monthKey])
      ? bonusesByMonth[monthKey]
      : {}

  const { employeePayouts, netPay } = useMemo(() => {
    const emps = monthEmployees || []
    let totalNetTenge = 0
    const rows = emps.map((e) => {
      const t = totals[e.id] || { hours: 0, pay: 0 }
      const gC = tenge(t.pay || 0) * 100
      const dC = Math.max(0, tenge(monthShortageEntries[e.id] || 0)) * 100
      const bonus = tenge(Number(monthBonuses[e.id]) || 0)
      const nC = Math.max(0, gC - dC + bonus * 100)
      const netTenge = Math.round(nC / 100)
      totalNetTenge += netTenge
      return {
        id: e.id,
        hours: t.hours,
        gross: gC / 100,
        deduction: Math.round(dC / 100),
        bonus,
        net: netTenge,
      }
    })
    return { employeePayouts: rows, netPay: totalNetTenge }
  }, [monthEmployees, totals, monthShortageEntries, monthBonuses])
  const payoutById = useMemo(
    () => new Map(employeePayouts.map((row) => [row.id, row])),
    [employeePayouts],
  )

  const openPayrollPinModal = useCallback(
    (employeeId) => {
      if (canEdit || !employeeId) return
      if (payrollUnlocked[employeeId]) return
      const emp = (monthEmployees || []).find((e) => e.id === employeeId)
      setPayrollPinModal({
        open: true,
        employeeId,
        employeeName: emp?.name || 'Сотрудник',
      })
    },
    [canEdit, monthEmployees, payrollUnlocked],
  )

  const closePayrollPinModal = () => {
    setPayrollPinModal({ open: false, employeeId: '', employeeName: '' })
  }

  const handlePayrollPinVerify = async (pin) => {
    const { employeeId } = payrollPinModal
    if (!employeeId) return false
    setPayrollPinVerifying(true)
    try {
      const res = await verifyPayrollPin({ employeeId, pin, monthKey })
      if (!res?.success || !res.payout) return false
      setPayrollUnlocked((prev) => ({ ...prev, [employeeId]: res.payout }))
      closePayrollPinModal()
      return true
    } finally {
      setPayrollPinVerifying(false)
    }
  }

  const handlePayrollFilterChange = (employeeId) => {
    setPayrollEmployeeFilter(employeeId)
    if (employeeId && !canEdit && !payrollUnlocked[employeeId]) {
      openPayrollPinModal(employeeId)
    }
  }

  const switchScheduleTab = (tab) => {
    if (tab !== 'payroll' && scheduleTab === 'payroll') {
      resetPayrollAccess()
    }
    setScheduleTab(tab)
  }

  const getPayrollDisplayRow = (employeeId) => {
    const hours = (totals[employeeId] || { hours: 0 }).hours
    if (canEdit) {
      const row = payoutById.get(employeeId) || { hours: 0, gross: 0, net: 0 }
      return { ...row, hours, hourlyRate: null, locked: false }
    }
    const unlocked = payrollUnlocked[employeeId]
    if (unlocked) {
      return {
        hours: unlocked.hours ?? hours,
        gross: unlocked.gross,
        net: unlocked.net,
        hourlyRate: unlocked.hourlyRate,
        locked: false,
      }
    }
    return { hours, gross: null, net: null, hourlyRate: null, locked: true }
  }

  const setShortageForEmployeeMonth = (employeeId, raw) => {
    const sm = { ...shortageMap }
    const currentMonthShortage = sm[monthKey]
    const currentEntries =
      currentMonthShortage && typeof currentMonthShortage === 'object' && !Array.isArray(currentMonthShortage)
        ? { ...currentMonthShortage }
        : Object.fromEntries(
            (monthEmployees || []).map((employee) => [employee.id, tenge(Math.max(0, Number(currentMonthShortage) || 0) / Math.max(1, (monthEmployees || []).length))]),
          )

    if (raw === '' || raw === null) {
      delete currentEntries[employeeId]
      if (Object.keys(currentEntries).length === 0) {
        delete sm[monthKey]
      } else {
        sm[monthKey] = currentEntries
      }
      onChange({ ...data, shortageByMonth: sm })
      return
    }

    currentEntries[employeeId] = tenge(Math.max(0, Number(raw) || 0))
    sm[monthKey] = currentEntries
    onChange({ ...data, shortageByMonth: sm })
  }

  const setBonusForEmployeeMonth = (employeeId, raw) => {
    const all = { ...(data.bonusesByMonth || {}) }
    const currentMonth = {
      ...(all[monthKey] && typeof all[monthKey] === 'object' && !Array.isArray(all[monthKey]) ? all[monthKey] : {}),
    }
    if (raw === '' || raw === null) {
      delete currentMonth[employeeId]
    } else {
      currentMonth[employeeId] = tenge(Math.max(0, Number(raw) || 0))
    }
    if (Object.keys(currentMonth).length === 0) {
      delete all[monthKey]
    } else {
      all[monthKey] = currentMonth
    }
    onChange({ ...data, bonusesByMonth: all })
  }

  const setField = (key, val) => {
    onChange({ ...data, [key]: val })
  }

  const setMonthEmployees = (nextEmployees) => {
    const all = { ...(data.employeesByMonth || {}) }
    const clean = Array.isArray(nextEmployees) ? nextEmployees : []
    if (clean.length === 0) delete all[monthKey]
    else all[monthKey] = clean
    onChange({ ...data, employeesByMonth: all })
  }

  const addEmployee = () => {
    const color = PRESET_COLORS[(monthEmployees || []).length % PRESET_COLORS.length]
    const next = [
      ...(monthEmployees || []),
      { id: newEmployeeId(), name: 'Сотрудник', email: '', color, hourlyRate: 300 },
    ]
    setMonthEmployees(next)
  }

  const updateEmployee = (id, patch) => {
    setMonthEmployees((monthEmployees || []).map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }

  const addRatePeriod = (id) => {
    const today = new Date().toISOString().slice(0, 10)
    const emp = (monthEmployees || []).find((e) => e.id === id)
    const current = normalizeRateHistory(emp?.rateHistory)
    updateEmployee(id, { rateHistory: [...current, { from: today, to: today, rate: Number(emp?.hourlyRate) || 0 }] })
  }

  const updateRatePeriod = (id, index, patch) => {
    const emp = (monthEmployees || []).find((e) => e.id === id)
    const current = normalizeRateHistory(emp?.rateHistory)
    const next = current.map((r, i) => {
      if (i !== index) return r
      const merged = { ...r, ...patch }
      if (merged.mode === 'period' && merged.to && merged.to < merged.from) merged.to = merged.from
      if (merged.mode === 'day') merged.to = merged.from
      if (merged.mode === 'from') merged.to = null
      return merged
    })
    updateEmployee(id, { rateHistory: next })
  }

  const setRatePeriodMode = (id, index, mode) => {
    const emp = (monthEmployees || []).find((e) => e.id === id)
    const current = normalizeRateHistory(emp?.rateHistory)
    const next = current.map((r, i) => {
      if (i !== index) return r
      if (mode === 'from') return { ...r, mode, to: null }
      if (mode === 'day') return { ...r, mode, to: r.from }
      return { ...r, mode, to: r.to && r.to >= r.from ? r.to : r.from }
    })
    updateEmployee(id, { rateHistory: next })
  }

  const removeRatePeriod = (id, index) => {
    const emp = (monthEmployees || []).find((e) => e.id === id)
    const current = normalizeRateHistory(emp?.rateHistory)
    updateEmployee(id, { rateHistory: current.filter((_, i) => i !== index) })
  }

  const removeEmployee = (id) => {
    const nextBonuses = {}
    Object.entries(data.bonusesByMonth || {}).forEach(([mk, monthMap]) => {
      if (!monthMap || typeof monthMap !== 'object' || Array.isArray(monthMap)) return
      const copy = { ...monthMap }
      delete copy[id]
      if (Object.keys(copy).length) nextBonuses[mk] = copy
    })
    onChange({
      ...data,
      employeesByMonth: {
        ...(data.employeesByMonth || {}),
        [monthKey]: (monthEmployees || []).filter((e) => e.id !== id),
      },
      shifts: (data.shifts || []).filter((s) => !(s.employeeId === id && String(s.date || '').startsWith(monthKey))),
      bonusesByMonth: nextBonuses,
    })
  }

  const openDayModal = (ymd) => {
    setDayModalError('')
    const existing = (data.shifts || []).filter((s) => s.date === ymd)
    const emps = monthEmployees || []
    const firstId = emps[0]?.id || ''

    if (existing.length === 0) {
      setDayModal({
        date: ymd,
        readOnly: !canEdit,
        rows: canEdit
          ? [{ id: newShiftId(), employeeId: firstId, start: '09:00', end: '18:00' }]
          : [],
      })
      return
    }

    setDayModal({
      date: ymd,
      readOnly: !canEdit,
      rows: existing.map((s) => ({
        id: s.id || newShiftId(),
        employeeId: s.employeeId,
        start: (s.start && String(s.start).trim()) || LEGACY_START,
        end: (s.end && String(s.end).trim()) || LEGACY_END,
      })),
    })
  }

  const closeDayModal = () => {
    setDayModal(null)
    setDayModalError('')
  }

  /** Удалить смены за выбранную дату (с учетом фильтра сотрудника). */
  const clearDayShifts = (ymd) => {
    if (!canEdit) return
    const has = (data.shifts || []).some(
      (s) => s.date === ymd && (!calendarEmployeeFilter || s.employeeId === calendarEmployeeFilter),
    )
    if (!has) return
    onChange({
      ...data,
      shifts: (data.shifts || []).filter(
        (s) => !(s.date === ymd && (!calendarEmployeeFilter || s.employeeId === calendarEmployeeFilter)),
      ),
    })
    showToast('Удалено')
    if (dayModal?.date === ymd) closeDayModal()
  }

  const copyPreviousDay = (ymd) => {
    if (!canEdit) return
    const prev = addDaysYmd(ymd, -1)
    const source = (data.shifts || []).filter(
      (s) => s.date === prev && (!calendarEmployeeFilter || s.employeeId === calendarEmployeeFilter),
    )
    if (source.length === 0) return
    const rest = (data.shifts || []).filter(
      (s) => !(s.date === ymd && (!calendarEmployeeFilter || s.employeeId === calendarEmployeeFilter)),
    )
    const copied = source.map((s) => ({ ...s, id: newShiftId(), date: ymd }))
    onChange({ ...data, shifts: [...rest, ...copied] })
    showToast('Скопировано')
  }

  const updateDayModalRow = (index, patch) => {
    setDayModal((prev) => {
      if (!prev || prev.readOnly) return prev
      const rows = prev.rows.map((r, i) => (i === index ? { ...r, ...patch } : r))
      return { ...prev, rows }
    })
  }

  const addDayModalRow = () => {
    setDayModal((prev) => {
      if (!prev || prev.readOnly) return prev
      const firstId = (monthEmployees || [])[0]?.id || ''
      return {
        ...prev,
        rows: [
          ...prev.rows,
          { id: newShiftId(), employeeId: firstId, start: '09:00', end: '18:00' },
        ],
      }
    })
  }

  const removeDayModalRow = (index) => {
    setDayModal((prev) => {
      if (!prev || prev.readOnly) return prev
      return { ...prev, rows: prev.rows.filter((_, i) => i !== index) }
    })
  }

  const saveDayModal = () => {
    if (!dayModal || dayModal.readOnly) return
    const { date, rows } = dayModal
    const hasIncomplete = rows.some((r) => {
      const empty = !r.employeeId && !r.start && !r.end
      if (empty) return false
      const ok = r.employeeId && r.start && r.end
      return !ok
    })
    if (hasIncomplete) {
      setDayModalError('У каждой заполненной строки укажите сотрудника и время «с» и «до». Или очистите строку.')
      return
    }
    const validRows = rows.filter((r) => r.employeeId && r.start && r.end)
    const rest = (data.shifts || []).filter((s) => s.date !== date)
    const added = validRows.map((r) => ({
      id: r.id || newShiftId(),
      date,
      employeeId: r.employeeId,
      start: String(r.start).trim(),
      end: String(r.end).trim(),
    }))
    onChange({ ...data, shifts: [...rest, ...added] })
    showToast('Сохранено')
    closeDayModal()
  }

  const applyPattern22 = () => {
    if (!patternEmp || !patternStart) return
    const num = Math.min(120, Math.max(1, Number(patternDays) || 28))
    const preset = SHIFT_TEMPLATES[patternTemplate] || SHIFT_TEMPLATES.full
    let shifts = [...(data.shifts || [])]
    shifts = shifts.filter((s) => {
      if (s.employeeId !== patternEmp) return true
      let d = patternStart
      for (let i = 0; i < num; i++) {
        if (s.date === d) return false
        d = addDaysYmd(d, 1)
      }
      return true
    })
    let d = patternStart
    for (let i = 0; i < num; i++) {
      const inWork = patternMode === 'daily' ? true : i % 4 < 2
      if (inWork) {
        shifts.push({
          id: newShiftId(),
          date: d,
          employeeId: patternEmp,
          start: preset.start,
          end: preset.end,
        })
      }
      d = addDaysYmd(d, 1)
    }
    onChange({ ...data, shifts })
    setPatternOpen(false)
  }

  const monthLabel = new Date(year, month, 1).toLocaleString('ru-RU', { month: 'long', year: 'numeric' })
  const todayYmd = new Date().toISOString().slice(0, 10)
  const weekStart = addDaysYmd(todayYmd, -((new Date(todayYmd).getDay() + 6) % 7))
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i)), [weekStart])

  const buildSchedulePdfPayload = useCallback(() => {
    const calendarRows = dates.map((ymd) => {
      const dayShifts = shiftsByDate.get(ymd) || []
      const lines = dayShifts.map((s) => {
        const emp = (monthEmployees || []).find((x) => x.id === s.employeeId)
        const h = shiftHours(s, LEGACY_START, LEGACY_END)
        const range = formatShiftRange(s, LEGACY_START, LEGACY_END)
        return `${emp?.name || '?'}: ${range}, ${h} ч`
      })
      return {
        label: `${weekdayShortRu(ymd)} ${formatRuDate(ymd)}`,
        shiftsText: lines.length ? lines.join('\n') : '—',
      }
    })
    const summaryRows = (monthEmployees || []).map((e, i) => {
      const row = employeePayouts[i] || { hours: 0, gross: 0, net: 0 }
      return {
        name: e.name,
        hours: row.hours,
        gross: tenge(row.gross),
        net: tenge(row.net),
      }
    })
    return {
      title: monthLabel,
      filenameStem: monthKey,
      calendarRows,
      summary: canEdit
        ? {
            rows: summaryRows,
            totalHours: grandTotal.hours,
            totalGross: tenge(grandTotal.pay),
            shortage: employeePayouts.reduce((sum, row) => sum + (row.deduction || 0), 0),
            netPay: tenge(netPay),
          }
        : null,
    }
  }, [
    dates,
    shiftsByDate,
    monthEmployees,
    employeePayouts,
    grandTotal.hours,
    grandTotal.pay,
    monthLabel,
    monthKey,
    hasShortageKey,
    netPay,
    canEdit,
  ])

  const handleExportPdf = async () => {
    setPdfError('')
    setPdfBusy(true)
    try {
      await exportScheduleToPdf(buildSchedulePdfPayload())
    } catch (e) {
      setPdfError(e?.message || 'Не удалось создать PDF')
    } finally {
      setPdfBusy(false)
    }
  }

  const handleSaveSchedule = async () => {
    await onSave()
    showToast('Сохранено')
  }

  const goToToday = () => {
    const t = new Date()
    const targetYear = t.getFullYear()
    const targetMonth = t.getMonth()
    const targetYmd = t.toISOString().slice(0, 10)
    setYear(targetYear)
    setMonth(targetMonth)
    requestAnimationFrame(() => {
      const row = document.querySelector(`[data-day-row="${targetYmd}"]`)
      if (row && typeof row.scrollIntoView === 'function') {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    })
  }

  return (
    <section className="schedule-page">
      {loadError ? <p className="error">{loadError}</p> : null}
      <div className="schedule-status-bar">
        <span className={`schedule-status-pill ${isOnline ? 'is-online' : 'is-offline'}`}>
          {isOnline ? 'Онлайн' : 'Оффлайн'}
        </span>
        <span className={`schedule-status-pill ${saveState?.dirty ? 'is-dirty' : 'is-saved'}`}>
          {saveState?.dirty ? 'Есть несохраненные изменения' : statusSavedAt ? `Сохранено ${statusSavedAt}` : 'Сохранено'}
        </span>
      </div>

      <div className="schedule-toolbar schedule-toolbar-row">
        {!canEdit ? (
          onRequestUnlock ? (
            <button
              type="button"
              className="btn btn-dark schedule-toolbar-icon-btn"
              onClick={onRequestUnlock}
              aria-label="Редактировать график (PIN)"
              title="Редактировать"
            >
              <ToolbarIcon type="edit" />
            </button>
          ) : (
            <span className="muted small schedule-readonly-hint">График: только просмотр</span>
          )
        ) : (
          <button
            type="button"
            className="btn btn-dark schedule-unlock"
            onClick={handleSaveSchedule}
            disabled={saving}
          >
            {saving ? 'Сохранение...' : 'Сохранить в таблицу'}
          </button>
        )}
        {onReload ? (
          <button
            type="button"
            className="ghost-btn schedule-toolbar-icon-btn"
            onClick={onReload}
            aria-label="Обновить с сервера"
            title="Обновить"
          >
            <ToolbarIcon type="refresh" />
          </button>
        ) : null}
        <button type="button" className="ghost-btn schedule-reload" onClick={goToToday}>
          Сегодня
        </button>
        <button
          type="button"
          className="ghost-btn schedule-toolbar-icon-btn"
          onClick={handleExportPdf}
          disabled={pdfBusy}
          aria-label="Скачать PDF"
          title="Скачать PDF"
        >
          <ToolbarIcon type="download" />
        </button>
        {canEdit ? (
          <button type="button" className="ghost-btn schedule-reload" onClick={onExitEdit}>
            Выйти из редактирования
          </button>
        ) : null}
      </div>
      {loading ? <div className="schedule-loading schedule-loading-animated" role="status" aria-live="polite">Обновляю данные…</div> : null}
      {saveError ? <p className="error">{saveError}</p> : null}
      {pdfError ? <p className="error">{pdfError}</p> : null}

      <div className="schedule-view-tabs">
        <button
          type="button"
          className={`chip ${scheduleTab === 'calendar' ? 'chip-active' : ''}`}
          onClick={() => switchScheduleTab('calendar')}
        >
          Календарь
        </button>
        <button
          type="button"
          className={`chip ${scheduleTab === 'payroll' ? 'chip-active' : ''}`}
          onClick={() => switchScheduleTab('payroll')}
        >
          К выплате
        </button>
      </div>

      {scheduleTab === 'calendar' ? (
        <>
      <p className="muted small schedule-hint">
        Нажмите на <strong>дату</strong> в списке ниже, чтобы задать смены и часы на этот день.
      </p>
      <label className="schedule-modal-field schedule-payroll-filter">
        Фильтр календаря по сотруднику
        <select value={calendarEmployeeFilter} onChange={(e) => setCalendarEmployeeFilter(e.target.value)}>
          <option value="">Все</option>
          {(monthEmployees || []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>

      <div className="schedule-employees card-primary">
        <div className="schedule-employees-head">
          <h4>Сотрудники</h4>
          {canEdit ? (
            <button type="button" className="ghost-btn" onClick={addEmployee}>
              + Добавить
            </button>
          ) : null}
        </div>
        {(monthEmployees || []).length === 0 ? (
          <p className="muted">Добавьте сотрудников, затем откройте день в календаре.</p>
        ) : null}
        <div className="schedule-emp-list">
          {loading
            ? Array.from({ length: 3 }).map((_, idx) => <div key={`emp-sk-${idx}`} className="schedule-skeleton-card shimmer" />)
            : (monthEmployees || []).map((e) => (
            <div key={e.id} className="schedule-emp-card" style={{ borderColor: e.color }}>
              <span className="schedule-color-swatch" style={{ background: e.color }} aria-hidden />
              <div className="schedule-emp-fields">
                <input
                  className="schedule-emp-name"
                  value={e.name}
                  onChange={(ev) => updateEmployee(e.id, { name: ev.target.value })}
                  disabled={!canEdit}
                  placeholder="Имя"
                />
                <input
                  className="schedule-emp-email"
                  type="email"
                  inputMode="email"
                  value={e.email || ''}
                  onChange={(ev) => updateEmployee(e.id, { email: ev.target.value.trim() })}
                  disabled={!canEdit}
                  placeholder="Email для привязки к аккаунту"
                />
                {canEdit ? (
                <label className="schedule-rate">
                  ₸/час
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={e.hourlyRate}
                    onChange={(ev) => updateEmployee(e.id, { hourlyRate: Number(ev.target.value) || 0 })}
                  />
                </label>
                ) : null}
                {canEdit ? (
                  <label className="schedule-rate schedule-payroll-pin">
                    PIN выплат
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={4}
                      value={e.payrollPin ?? ''}
                      onChange={(ev) =>
                        updateEmployee(e.id, { payrollPin: ev.target.value.replace(/\D/g, '').slice(0, 4) })
                      }
                      placeholder={e.hasPayrollPin ? '••••' : '4 цифры'}
                    />
                  </label>
                ) : null}
                {canEdit ? (
                  <div className="schedule-rates">
                    <div className="schedule-rates-head">
                      <strong>Ставки по датам</strong>
                      <button type="button" className="ghost-btn" onClick={() => addRatePeriod(e.id)}>
                        + Ставка
                      </button>
                    </div>
                    {normalizeRateHistory(e.rateHistory).map((r, idx) => (
                      <div key={`${e.id}-rate-${idx}`} className="schedule-rate-row">
                        <select
                          value={rateMode(r)}
                          onChange={(ev) => setRatePeriodMode(e.id, idx, ev.target.value)}
                        >
                          <option value="from">С даты</option>
                          <option value="day">День</option>
                          <option value="period">Период</option>
                        </select>
                        <input
                          type="date"
                          value={r.from}
                          onChange={(ev) => updateRatePeriod(e.id, idx, { from: ev.target.value })}
                        />
                        {rateMode(r) === 'period' ? (
                          <input
                            type="date"
                            value={r.to || r.from}
                            min={r.from}
                            onChange={(ev) => updateRatePeriod(e.id, idx, { to: ev.target.value })}
                          />
                        ) : null}
                        <input
                          type="number"
                          min={0}
                          step={10}
                          value={r.rate}
                          onChange={(ev) => updateRatePeriod(e.id, idx, { rate: Number(ev.target.value) || 0 })}
                        />
                        <button
                          type="button"
                          className="ghost-btn schedule-rate-remove"
                          onClick={() => removeRatePeriod(e.id, idx)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {canEdit ? (
                  <input
                    type="color"
                    className="schedule-color-input"
                    value={e.color?.startsWith('#') ? e.color : '#dbeafe'}
                    onChange={(ev) => updateEmployee(e.id, { color: ev.target.value })}
                  />
                ) : null}
              </div>
              {canEdit ? (
                <button type="button" className="ghost-btn schedule-emp-remove" onClick={() => removeEmployee(e.id)}>
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {canEdit ? (
        <div className="schedule-pattern-bar">
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              if (!patternStart && dates[0]) setPatternStart(dates[0])
              if (!patternEmp && (monthEmployees || [])[0]) setPatternEmp(monthEmployees[0].id)
              setPatternOpen(true)
            }}
          >
            Шаблоны смен
          </button>
          <span className="muted small schedule-pattern-hint">утро / вечер / полная и массовое применение</span>
        </div>
      ) : null}

      <div className="schedule-week-strip">
        {weekDates.map((ymd) => {
          const dayShifts = (shiftsByDate.get(ymd) || []).filter(
            (s) => !calendarEmployeeFilter || s.employeeId === calendarEmployeeFilter,
          )
          const count = dayShifts.length
          const firstShift = dayShifts[0]
          const firstEmp = (monthEmployees || []).find((x) => x.id === firstShift?.employeeId)
          const bg = count > 0 ? softTint(firstEmp?.color, 0.24) : '#f7f6f3'
          const border = count > 0 ? softTint(firstEmp?.color, 0.5) : '#eceae5'
          const { main, muted } = chipTextColors(firstEmp?.color || '#f3f2ef')
          return (
            <button
              key={ymd}
              type="button"
              className={`schedule-week-day ${count > 0 ? 'has-shifts' : ''} ${ymd === todayYmd ? 'is-today' : ''}`}
              onClick={() => openDayModal(ymd)}
              style={{
                background: bg,
                boxShadow: `inset 0 0 0 1px ${border}`,
                color: count > 0 ? main : undefined,
                ['--week-muted']: count > 0 ? muted : '#7f7c76',
              }}
            >
              <span className="schedule-week-wd">{weekdayShortRu(ymd)}</span>
              <span className="schedule-week-num">{ymd.slice(-2)}</span>
              <span className="schedule-week-count">{count || '—'}</span>
            </button>
          )
        })}
      </div>

      <div className="schedule-month-nav">
        <button
          type="button"
          className="icon-btn schedule-nav-btn"
          onClick={() => {
            if (month === 0) {
              setMonth(11)
              setYear((y) => y - 1)
            } else setMonth((m) => m - 1)
          }}
        >
          ←
        </button>
        <h4 className="schedule-month-title">{monthLabel}</h4>
        <button
          type="button"
          className="icon-btn schedule-nav-btn"
          onClick={() => {
            if (month === 11) {
              setMonth(0)
              setYear((y) => y + 1)
            } else setMonth((m) => m + 1)
          }}
        >
          →
        </button>
      </div>

      <div className="schedule-calendar card-secondary">
        {loading
          ? Array.from({ length: 7 }).map((_, idx) => <div key={`day-sk-${idx}`} className="schedule-skeleton-day shimmer" />)
          : dates.map((ymd) => {
          const dayShifts = (shiftsByDate.get(ymd) || []).filter(
            (s) => !calendarEmployeeFilter || s.employeeId === calendarEmployeeFilter,
          )
          return (
            <div key={ymd} className={`schedule-day-row ${ymd === todayYmd ? 'is-today' : ''}`} data-day-row={ymd}>
              <div className="schedule-day-label-col">
                <button
                  type="button"
                  className={`schedule-day-label ${canEdit ? 'is-tappable' : ''} ${ymd === todayYmd ? 'is-today' : ''}`}
                  onClick={() => openDayModal(ymd)}
                >
                  <span className="schedule-day-wd">{weekdayShortRu(ymd)}</span>
                  <span className="schedule-day-num">{formatRuDate(ymd)}</span>
                </button>
              </div>
              <div className="schedule-day-chips">
                {dayShifts.map((s) => {
                  const emp = (monthEmployees || []).find((x) => x.id === s.employeeId)
                  const h = shiftHours(s, LEGACY_START, LEGACY_END)
                  const range = formatShiftRange(s, LEGACY_START, LEGACY_END)
                  const key = s.id || `${s.date}-${s.employeeId}-${range}`
                  const bg = emp?.color || '#eee'
                  const { main, muted } = chipTextColors(bg)
                  return (
                    <div key={key} className="schedule-chip-row">
                      <div
                        className="schedule-chip schedule-chip-readonly"
                        style={{
                          background: bg,
                          color: main,
                          ['--chip-muted']: muted,
                        }}
                      >
                        <span className="schedule-chip-name">{emp?.name || '?'}</span>
                        <span className="schedule-chip-range">{range}</span>
                        <span className="schedule-chip-h">{h} ч</span>
                      </div>
                    </div>
                  )
                })}
                {dayShifts.length === 0 ? <span className="muted schedule-day-empty">—</span> : null}
              </div>
              {canEdit && dayShifts.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="schedule-day-copy"
                    onClick={(e) => {
                      e.stopPropagation()
                      copyPreviousDay(ymd)
                    }}
                    aria-label={`Копировать смены с предыдущего дня на ${formatRuDate(ymd)}`}
                    title="Копировать с предыдущего дня"
                  >
                    ⎘
                  </button>
                  <button
                    type="button"
                    className="schedule-day-clear"
                    onClick={(e) => {
                      e.stopPropagation()
                      clearDayShifts(ymd)
                    }}
                    aria-label={`Очистить смены за ${formatRuDate(ymd)}`}
                    title="Удалить смены за этот день"
                  >
                    ×
                  </button>
                </>
              ) : null}
            </div>
          )
        })}
      </div>
        </>
      ) : null}

      {scheduleTab === 'payroll' ? (
      <div className="schedule-totals card-primary">
        <h4>Итого за месяц</h4>
        {!canEdit ? (
          <p className="muted small schedule-payroll-hint">
            Выберите сотрудника и введите PIN, чтобы увидеть ставку и суммы к выплате.
          </p>
        ) : null}
        <label className="schedule-modal-field schedule-payroll-filter">
          Фильтр по сотруднику
          <select value={payrollEmployeeFilter} onChange={(e) => handlePayrollFilterChange(e.target.value)}>
            <option value="">Все</option>
            {(monthEmployees || []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <div className="schedule-totals-grid">
          <div className="schedule-total-row schedule-totals-head" aria-hidden>
            <span className="schedule-total-dot schedule-total-dot-spacer" />
            <span className="muted">Имя</span>
            <span className="muted schedule-total-col-num">Часы</span>
            <span className="muted schedule-total-col-num">Начислено</span>
            <span className="muted schedule-total-col-num">К выплате</span>
          </div>
          {(monthEmployees || [])
            .filter((e) => !payrollEmployeeFilter || e.id === payrollEmployeeFilter)
            .map((e) => {
              const row = getPayrollDisplayRow(e.id)
              return (
                <div
                  key={e.id}
                  className={`schedule-total-row ${row.locked ? 'is-payroll-locked' : ''}`}
                  onClick={row.locked ? () => openPayrollPinModal(e.id) : undefined}
                  onKeyDown={
                    row.locked
                      ? (ev) => {
                          if (ev.key === 'Enter' || ev.key === ' ') {
                            ev.preventDefault()
                            openPayrollPinModal(e.id)
                          }
                        }
                      : undefined
                  }
                  role={row.locked ? 'button' : undefined}
                  tabIndex={row.locked ? 0 : undefined}
                >
                  <span className="schedule-total-dot" style={{ background: e.color }} />
                  <span className="schedule-total-name">
                    <span className="schedule-total-name-text">{e.name}</span>
                    {!canEdit && row.hourlyRate != null ? (
                      <span className="schedule-payroll-rate">{row.hourlyRate} ₸/ч</span>
                    ) : null}
                  </span>
                  <strong className="schedule-total-col-num">{row.hours} ч</strong>
                  <strong className="schedule-total-col-num">
                    {row.locked ? (
                      <span className="schedule-payroll-mask" title="Введите PIN">
                        ••••
                      </span>
                    ) : (
                      `${tenge(row.gross)} ₸`
                    )}
                  </strong>
                  <strong className="schedule-total-col-num schedule-total-net">
                    {row.locked ? (
                      <span className="schedule-payroll-mask" title="Введите PIN">
                        ••••
                      </span>
                    ) : (
                      `${tenge(row.net)} ₸`
                    )}
                  </strong>
                </div>
              )
            })}
        </div>
        {canEdit ? (
          <>
        <div className="schedule-grand">
          <span>Всего часов</span>
          <strong>{grandTotal.hours} ч</strong>
          <span>Начислено всего</span>
          <strong>{tenge(grandTotal.pay)} ₸</strong>
        </div>
        <div className="schedule-shortage-block">
          <h5 className="schedule-bonus-title">Недостача за месяц</h5>
          <div className="schedule-bonus-grid">
            {(monthEmployees || []).map((e) => (
              <label key={e.id} className="schedule-bonus-row">
                <span className="schedule-bonus-name">{e.name}</span>
                <input
                  type="number"
                  min={0}
                  step={100}
                  className="schedule-shortage-input"
                  value={monthShortageEntries[e.id] ?? ''}
                  onChange={(ev) => setShortageForEmployeeMonth(e.id, ev.target.value)}
                  disabled={!canEdit}
                  placeholder="0"
                />
                <span className="schedule-currency-suffix">₸</span>
              </label>
            ))}
          </div>
          <p className="muted small">Недостача указывается индивидуально для каждого сотрудника и вычитается из его выплаты.</p>
        </div>
        <div className="schedule-shortage-block">
          <h5 className="schedule-bonus-title">Бонус за месяц</h5>
          <div className="schedule-bonus-grid">
            {(monthEmployees || []).map((e) => (
              <label key={e.id} className="schedule-bonus-row">
                <span className="schedule-bonus-name">{e.name}</span>
                <input
                  type="number"
                  min={0}
                  step={100}
                  className="schedule-shortage-input"
                  value={monthBonuses[e.id] ?? ''}
                  onChange={(ev) => setBonusForEmployeeMonth(e.id, ev.target.value)}
                  disabled={!canEdit}
                  placeholder="0"
                />
                <span className="schedule-currency-suffix">₸</span>
              </label>
            ))}
          </div>
          <p className="muted small">Добавляется к выплате выбранного месяца для каждого сотрудника отдельно.</p>
        </div>
        <div className="schedule-grand schedule-grand-net">
          <span>К выплате всего</span>
          <strong>{tenge(netPay)} ₸</strong>
        </div>
          </>
        ) : null}
      </div>
      ) : null}

      <PayrollPinModal
        isOpen={payrollPinModal.open}
        title="PIN выплат"
        subtitle={payrollPinModal.employeeName ? `Сотрудник: ${payrollPinModal.employeeName}` : ''}
        onVerify={handlePayrollPinVerify}
        onClose={closePayrollPinModal}
        verifying={payrollPinVerifying}
      />

      {patternOpen ? (
        <div className="export-modal-backdrop" onClick={() => setPatternOpen(false)}>
          <div className="export-modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Шаблоны смен</h3>
            <p className="muted small">
              Применяется для сотрудника в выбранном диапазоне дней.
            </p>
            <label className="schedule-modal-field">
              Режим
              <select value={patternMode} onChange={(e) => setPatternMode(e.target.value)}>
                <option value="22">2/2</option>
                <option value="daily">Каждый день</option>
              </select>
            </label>
            <label className="schedule-modal-field">
              Шаблон
              <select value={patternTemplate} onChange={(e) => setPatternTemplate(e.target.value)}>
                {Object.entries(SHIFT_TEMPLATES).map(([key, t]) => (
                  <option key={key} value={key}>
                    {t.label} ({t.start}-{t.end})
                  </option>
                ))}
              </select>
            </label>
            <label className="schedule-modal-field">
              Сотрудник
              <select value={patternEmp} onChange={(e) => setPatternEmp(e.target.value)}>
                <option value="">—</option>
                {(monthEmployees || []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="schedule-modal-field">
              Первый рабочий день
              <input type="date" value={patternStart} onChange={(e) => setPatternStart(e.target.value)} />
            </label>
            <label className="schedule-modal-field">
              Дней подряд
              <input
                type="number"
                min={1}
                max={120}
                value={patternDays}
                onChange={(e) => setPatternDays(Number(e.target.value) || 28)}
              />
            </label>
            <div className="export-actions">
              <button type="button" className="ghost-btn" onClick={() => setPatternOpen(false)}>
                Отмена
              </button>
              <button type="button" className="btn btn-dark" onClick={applyPattern22} disabled={!patternEmp || !patternStart}>
                Применить
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {dayModal ? (
        <div className="export-modal-backdrop" onClick={closeDayModal}>
          <div className="export-modal schedule-day-edit-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{formatRuDate(dayModal.date)}</h3>
            <p className="muted small">
              {dayModal.readOnly ? 'Смены на этот день' : 'Сотрудник и часы по каждому интервалу'}
            </p>

            {dayModal.readOnly && dayModal.rows.length === 0 ? (
              <p className="muted">На этот день смен нет.</p>
            ) : null}

            <div className="schedule-day-modal-rows">
              {dayModal.rows.map((row, idx) => (
                <div key={row.id} className="schedule-day-modal-row">
                  {!dayModal.readOnly ? (
                    <button
                      type="button"
                      className="ghost-btn schedule-day-modal-remove"
                      onClick={() => removeDayModalRow(idx)}
                      aria-label="Удалить интервал"
                    >
                      ×
                    </button>
                  ) : null}
                  <label className="schedule-day-modal-field">
                    Сотрудник
                    <select
                      value={row.employeeId}
                      disabled={dayModal.readOnly}
                      onChange={(e) => updateDayModalRow(idx, { employeeId: e.target.value })}
                    >
                      <option value="">—</option>
                      {(monthEmployees || []).map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="schedule-day-modal-times">
                    <label>
                      С
                      <input
                        type="time"
                        value={row.start}
                        disabled={dayModal.readOnly}
                        onChange={(e) => updateDayModalRow(idx, { start: e.target.value })}
                      />
                    </label>
                    <label>
                      До
                      <input
                        type="time"
                        value={row.end}
                        disabled={dayModal.readOnly}
                        onChange={(e) => updateDayModalRow(idx, { end: e.target.value })}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>

            {!dayModal.readOnly ? (
              <button type="button" className="ghost-btn schedule-day-modal-add" onClick={addDayModalRow}>
                + Интервал
              </button>
            ) : null}

            {dayModalError ? <p className="error small">{dayModalError}</p> : null}

            <div className="export-actions">
              <button type="button" className="ghost-btn" onClick={closeDayModal}>
                {dayModal.readOnly ? 'Закрыть' : 'Отмена'}
              </button>
              {!dayModal.readOnly ? (
                <button type="button" className="btn btn-dark" onClick={saveDayModal}>
                  Сохранить день
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {toastText ? <div className="app-toast">{toastText}</div> : null}
    </section>
  )
}

export default ScheduleView
