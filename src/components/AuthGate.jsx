import { useEffect, useState } from 'react'
import supabase, { isSupabaseConfigured } from '../api/supabaseClient'

function normalizeCredential(value) {
  return String(value || '').trim()
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function AuthGate({ isOpen, onClose, onSuccess, title = 'Вход в BB', allowClose = false, initialMode = 'signIn' }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [mode, setMode] = useState(initialMode)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setEmail('')
      setPassword('')
      setFullName('')
      setMode(initialMode)
      setError('')
      setSuccess('')
      setSubmitting(false)
    }
  }, [initialMode, isOpen])

  if (!isOpen) return null

  const submit = (event) => {
    event.preventDefault()
    const normalizedEmail = normalizeCredential(email)
    const normalizedPassword = normalizeCredential(password)
    const normalizedName = normalizeCredential(fullName)

    if (!normalizedEmail) {
      setError('Введите email')
      return
    }
    if (!isEmail(normalizedEmail)) {
      setError('Введите корректный email')
      return
    }

    if (mode === 'resetPassword') {
      ;(async () => {
        setSubmitting(true)
        setError('')
        setSuccess('')
        try {
          const redirectTo = `${window.location.origin}${window.location.pathname}?reset=1`
          const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo })
          if (resetError) throw resetError
          setSuccess('Письмо для сброса пароля отправлено. Проверьте почту.')
        } catch (err) {
          setError(err?.message || 'Не удалось отправить письмо для сброса пароля')
        } finally {
          setSubmitting(false)
        }
      })()
      return
    }

    if (!normalizedPassword) {
      setError('Введите пароль')
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
          const { data, error: signInError } = await supabase.auth.signInWithPassword({
            email: normalizedEmail,
            password: normalizedPassword,
          })
          if (signInError) throw signInError
          if (data?.session?.user) {
            onSuccess({
              user: data.session.user,
              session: data.session,
              fullName: normalizedName,
            })
          } else {
            setSuccess('Вход выполнен. Если интерфейс не обновился, перезагрузите страницу.')
          }
        } else {
          const { data, error: signUpError } = await supabase.auth.signUp({
            email: normalizedEmail,
            password: normalizedPassword,
            options: {
              data: {
                full_name: normalizedName,
              },
            },
          })
          if (signUpError) throw signUpError
          if (data?.session?.user) {
            onSuccess({
              user: data.session.user,
              session: data.session,
              fullName: normalizedName,
            })
          } else if (data?.user) {
            setSuccess('Аккаунт создан. Теперь войдите с email и паролем.')
            setMode('signIn')
          } else {
            setSuccess('Регистрация отправлена. Попробуйте войти.')
            setMode('signIn')
          }
        }
      } catch (err) {
        setError(err?.message || 'Ошибка авторизации')
      } finally {
        setSubmitting(false)
      }
    })()
  }

  const heading =
    mode === 'signIn' ? 'Вход в BB' : mode === 'signUp' ? 'Регистрация в BB' : 'Сброс пароля'

  return (
    <div className="pin-backdrop" onClick={allowClose ? onClose : undefined}>
      <div className="pin-modal auth-modal" onClick={(event) => event.stopPropagation()}>
        <h3>{title || heading}</h3>
        <p className="muted auth-hint">
          {mode === 'resetPassword'
            ? 'Мы отправим ссылку для установки нового пароля на ваш email.'
            : 'Вход по email и паролю через Supabase.'}
        </p>
        <form onSubmit={submit} className="auth-form">
          {mode === 'signUp' ? (
            <input
              className="auth-input"
              type="text"
              placeholder="Имя (необязательно)"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          ) : null}
          <input
            className="auth-input"
            type="email"
            autoFocus
            inputMode="email"
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {mode !== 'resetPassword' ? (
            <input
              className="auth-input"
              type="password"
              placeholder="Пароль"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          ) : null}
          <button type="submit" className="btn btn-dark auth-submit" disabled={submitting}>
            {submitting
              ? 'Отправляем...'
              : mode === 'signIn'
                ? 'Войти'
                : mode === 'signUp'
                  ? 'Зарегистрироваться'
                  : 'Отправить ссылку'}
          </button>
          {error ? <p className="error auth-error">{error}</p> : null}
          {success ? <p className="muted auth-success">{success}</p> : null}
        </form>
        {mode === 'signIn' ? (
          <button
            type="button"
            className="ghost-btn auth-toggle"
            onClick={() => {
              setMode('resetPassword')
              setError('')
              setSuccess('')
            }}
          >
            Забыли пароль?
          </button>
        ) : null}
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
        {mode === 'resetPassword' ? (
          <button
            type="button"
            className="ghost-btn auth-toggle"
            onClick={() => {
              setMode('signIn')
              setError('')
              setSuccess('')
            }}
          >
            Назад ко входу
          </button>
        ) : null}
        {!isSupabaseConfigured ? (
          <p className="error auth-error">Supabase не настроен. Проверьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.</p>
        ) : null}
      </div>
    </div>
  )
}

export default AuthGate
