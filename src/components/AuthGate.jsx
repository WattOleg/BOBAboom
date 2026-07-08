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
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('signIn')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setEmail('')
      setPassword('')
      setMode('signIn')
      setError('')
      setSuccess('')
      setSubmitting(false)
    }
  }, [isOpen])

  if (!isOpen) return null

  const submit = (event) => {
    event.preventDefault()
    const normalizedEmail = normalizeCredential(email)
    const normalizedPassword = normalizeCredential(password)

    if (!normalizedEmail || !normalizedPassword) {
      setError('Введите email и пароль')
      return
    }
    if (!isEmail(normalizedEmail)) {
      setError('Введите корректный email')
      return
    }
    if (normalizedPassword.length < 6) {
      setError('Пароль должен быть не менее 6 символов')
      return
    }

    ;(async () => {
      setSubmitting(true)
      setError('')
      setSuccess('')
      try {
        if (mode === 'signIn') {
          const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password: normalizedPassword })
          if (error) throw error
          if (data?.session?.user) {
            onSuccess({ id: data.session.user.id, email: data.session.user.email || null, phone: data.session.user.phone || null })
          } else {
            setSuccess('Вход выполнен. Если вы не видите интерфейс, обновите страницу.')
          }
        } else {
          const { data, error } = await supabase.auth.signUp({ email: normalizedEmail, password: normalizedPassword })
          if (error) throw error
          if (data?.user) {
            const userId = data.user.id
            await supabase.from('app_data').insert({
              key: `profile:${userId}`,
              value: { email: normalizedEmail, createdAt: new Date().toISOString() },
            })
            setSuccess('Пользователь создан. Войдите с помощью email и пароля.')
            setMode('signIn')
          } else {
            setSuccess('Пользователь зарегистрирован. Проверьте почту для подтверждения.')
          }
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
        <h3>{mode === 'signIn' ? 'Вход в BB' : 'Регистрация в BB'}</h3>
        <p className="muted auth-hint">
          Вход обязателен для создания, редактирования и удаления техкарт в BB.
        </p>
        <form onSubmit={submit} className="auth-form">
          <input
            className="auth-input"
            type="email"
            autoFocus
            inputMode="email"
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <input
            className="auth-input"
            type="password"
            placeholder="Пароль"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button type="submit" className="btn btn-dark auth-submit" disabled={submitting}>
            {submitting ? (mode === 'signIn' ? 'Входим...' : 'Регистрируем...') : mode === 'signIn' ? 'Войти' : 'Зарегистрироваться'}
          </button>
          {error ? <p className="error auth-error">{error}</p> : null}
          {success ? <p className="muted auth-success">{success}</p> : null}
        </form>
        <button
          type="button"
          className="ghost-btn auth-toggle"
          onClick={() => {
            setMode(mode === 'signIn' ? 'signUp' : 'signIn')
            setError('')
            setSuccess('')
          }}
        >
          {mode === 'signIn' ? 'Создать новый аккаунт' : 'Уже есть аккаунт? Войти'}
        </button>
      </div>
    </div>
  )
}

export default AuthGate
