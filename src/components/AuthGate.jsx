import { useEffect, useState } from 'react'
import supabase from '../api/supabaseClient'

function normalizeCredential(value) {
  return String(value || '').trim()
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isPhone(value) {
  const compact = value.replace(/[^\d+]/g, '')
  return /^(\+7|8)\d{10}$/.test(compact) || /^\+?\d{7,15}$/.test(compact)
}

function AuthGate({ isOpen, onClose, onSuccess, title = 'Вход в BB' }) {
  const [credential, setCredential] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setCredential('')
      setError('')
      setSubmitting(false)
    }
  }, [isOpen])

  if (!isOpen) return null

  const submit = (event) => {
    event.preventDefault()
    const value = normalizeCredential(credential)
    if (!value) {
      setError('Введите email или номер телефона')
      return
    }
    if (!isEmail(value) && !isPhone(value)) {
      setError('Введите корректный email или номер телефона')
      return
    }

    ;(async () => {
      setSubmitting(true)
      setError('')
      try {
        if (isEmail(value)) {
          const { error } = await supabase.auth.signInWithOtp({ email: value, options: { emailRedirectTo: window.location.origin } })
          if (error) throw error
          setError('Ссылка для входа отправлена на указанный email. Проверьте почту.')
        } else {
          // Phone OTP requires SMS provider configuration in Supabase project.
          const { error } = await supabase.auth.signInWithOtp({ phone: value })
          if (error) throw error
          setError('Код отправлен на указанный номер. После подтверждения вы войдёте автоматически.')
        }
      } catch (err) {
        setError(err?.message || 'Ошибка при попытке войти')
      } finally {
        setSubmitting(false)
      }
    })()
  }

  return (
    <div className="pin-backdrop" onClick={onClose}>
      <div className="pin-modal auth-modal" onClick={(event) => event.stopPropagation()}>
        <h3>{title}</h3>
        <p className="muted auth-hint">
          Вход обязателен для создания, редактирования и удаления техкарт в BB.
        </p>
        <form onSubmit={submit} className="auth-form">
          <input
            className="auth-input"
            type="text"
            autoFocus
            inputMode="email"
            placeholder="Email или номер телефона"
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
          />
          <button type="submit" className="btn btn-dark auth-submit" disabled={submitting}>
            {submitting ? 'Входим...' : 'Войти'}
          </button>
          {error ? <p className="error auth-error">{error}</p> : null}
        </form>
      </div>
    </div>
  )
}

export default AuthGate
