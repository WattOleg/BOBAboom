import { useEffect, useRef, useState } from 'react'

function PayrollPinModal({ isOpen, title, subtitle, onVerify, onClose, verifying }) {
  const [digits, setDigits] = useState('')
  const [shake, setShake] = useState(false)
  const [error, setError] = useState('')
  const verifyRef = useRef(onVerify)

  verifyRef.current = onVerify

  useEffect(() => {
    if (!isOpen) {
      setDigits('')
      setShake(false)
      setError('')
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || digits.length !== 4 || verifying) return
    let cancelled = false
    ;(async () => {
      try {
        const ok = await verifyRef.current(digits)
        if (cancelled) return
        if (ok) {
          setDigits('')
          setError('')
          return
        }
        setShake(true)
        setError('Неверный PIN')
        if (navigator.vibrate) navigator.vibrate(200)
        setTimeout(() => {
          setShake(false)
          setDigits('')
        }, 350)
      } catch (err) {
        if (cancelled) return
        setShake(true)
        setError(err?.message || 'Не удалось проверить PIN')
        if (navigator.vibrate) navigator.vibrate(200)
        setTimeout(() => {
          setShake(false)
          setDigits('')
          setError('')
        }, 350)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [digits, isOpen, verifying])

  if (!isOpen) return null

  const handleTap = (val) => {
    if (verifying) return
    if (val === 'back') {
      setDigits((prev) => prev.slice(0, -1))
      return
    }
    if (val === '*' || digits.length >= 4) return
    setDigits((prev) => prev + val)
  }

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', 'back']

  return (
    <div className="pin-backdrop" onClick={onClose}>
      <div className="pin-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title || 'PIN выплат'}</h3>
        {subtitle ? <p className="muted small payroll-pin-subtitle">{subtitle}</p> : null}
        <div className={`pin-dots ${shake ? 'shake' : ''}`}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={i < digits.length ? 'filled' : ''} />
          ))}
        </div>
        {verifying ? (
          <div className="payroll-pin-verifying" role="status" aria-live="polite">
            <span className="schedule-loading-spinner" aria-hidden />
            <span className="muted small">Проверка…</span>
          </div>
        ) : null}
        {error && !verifying ? <p className="error payroll-pin-error">{error}</p> : null}
        <div className="pin-pad">
          {keys.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => handleTap(key)}
              className="pin-key"
              disabled={verifying}
            >
              {key === 'back' ? '←' : key}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default PayrollPinModal
