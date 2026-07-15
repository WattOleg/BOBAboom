import { useEffect, useState } from 'react'
import supabase, { isSupabaseConfigured } from '../api/supabaseClient'

function normalizeCredential(value) {
  return String(value || '').trim()
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function readErrorText(err) {
  if (!err) return ''
  if (typeof err === 'string') return err.trim()
  const candidates = [err.message, err.error_description, err.error, err.msg, err.code]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim() && value.trim() !== '{}') {
      return value.trim()
    }
  }
  try {
    const json = JSON.stringify(err)
    if (json && json !== '{}' && json !== 'null') return json
  } catch {
    // ignore
  }
  return ''
}

function translateAuthError(err, context = 'signIn') {
  const message = readErrorText(err).toLowerCase()
  const status = err?.status
  const name = String(err?.name || '').toLowerCase()

  if (name.includes('authretryablefetcherror') || status === 500) {
    return 'Ошибка сервера. Попробуйте позже.'
  }
  if (message.includes('email not confirmed') || message.includes('email_not_confirmed')) {
    return 'Email не подтверждён.'
  }
  if (message.includes('invalid login credentials') || message.includes('invalid_credentials')) {
    if (context === 'afterExistingSignUp') {
      return 'Аккаунт уже есть. Войдите или сбросьте пароль.'
    }
    return 'Неверный email или пароль.'
  }
  if (message.includes('user already registered') || message.includes('already been registered')) {
    return 'Email уже зарегистрирован.'
  }
  if (message.includes('redirect') || message.includes('redirect_to')) {
    return 'Ошибка redirect URL.'
  }
  if (message.includes('password') && (message.includes('least') || message.includes('6'))) {
    return 'Пароль — минимум 6 символов.'
  }
  if (message.includes('rate limit') || status === 429) {
    return 'Слишком много попыток.'
  }
  if (message && message !== '{}') return readErrorText(err)
  return 'Не удалось выполнить операцию.'
}

function hasAuthError(error) {
  if (!error) return false
  if (typeof error === 'string') return Boolean(error.trim())
  return Boolean(readErrorText(error) || error.status || error.code || error.name)
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

  const finishWithSession = async (session, normalizedName) => {
    if (!session?.user) return false
    await onSuccess({
      user: session.user,
      session,
      fullName: normalizedName,
    })
    return true
  }

  const submit = (event) => {
    event.preventDefault()
    const normalizedEmail = normalizeCredential(email).toLowerCase()
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
          const origin = window.location.origin
          const redirectTo = `${origin}/?reset=1`
          const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo })
          if (hasAuthError(resetError)) throw resetError
          setSuccess('Письмо отправлено. Проверьте почту.')
        } catch (err) {
          setError(translateAuthError(err, 'reset'))
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
          if (hasAuthError(signInError)) throw signInError
          if (!(await finishWithSession(data?.session, normalizedName))) {
            setSuccess('Готово.')
          }
          return
        }

        const { data, error: signUpError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password: normalizedPassword,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: {
              full_name: normalizedName,
            },
          },
        })
        if (hasAuthError(signUpError)) throw signUpError

        if (await finishWithSession(data?.session, normalizedName)) return

        const alreadyExists = Boolean(
          data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0,
        )

        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password: normalizedPassword,
        })

        if (!hasAuthError(signInError) && (await finishWithSession(signInData?.session, normalizedName))) {
          return
        }

        setMode('signIn')
        if (alreadyExists) {
          setError(translateAuthError(signInError || { message: 'invalid login credentials' }, 'afterExistingSignUp'))
          return
        }

        if (hasAuthError(signInError)) {
          setError(translateAuthError(signInError, 'signIn'))
          return
        }

        setSuccess('Аккаунт создан. Войдите.')
      } catch (err) {
        setError(translateAuthError(err, mode))
      } finally {
        setSubmitting(false)
      }
    })()
  }

  const heading = mode === 'signIn' ? 'Вход' : mode === 'signUp' ? 'Регистрация' : 'Сброс пароля'

  return (
    <div className={`auth-screen ${allowClose ? 'auth-screen-overlay' : ''}`} onClick={allowClose ? onClose : undefined}>
      <div className="auth-card" onClick={(event) => event.stopPropagation()}>
        <div className="auth-brand">BOBA BOOM</div>
        <h3 className="auth-title">{heading}</h3>
        <form onSubmit={submit} className="auth-form">
          {mode === 'signUp' ? (
            <input
              className="auth-input"
              type="text"
              placeholder="Имя"
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
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {mode !== 'resetPassword' ? (
            <input
              className="auth-input"
              type="password"
              placeholder="Пароль"
              autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          ) : null}
          <button type="submit" className="btn btn-dark auth-submit" disabled={submitting}>
            {submitting
              ? '...'
              : mode === 'signIn'
                ? 'Войти'
                : mode === 'signUp'
                  ? 'Создать аккаунт'
                  : 'Отправить'}
          </button>
          {error ? <p className="error auth-error">{String(error)}</p> : null}
          {success ? <p className="auth-success">{success}</p> : null}
        </form>
        <div className="auth-links">
          {mode === 'signIn' ? (
            <button
              type="button"
              className="auth-link"
              onClick={() => {
                setMode('resetPassword')
                setError('')
                setSuccess('')
              }}
            >
              Забыли пароль?
            </button>
          ) : null}
          {mode !== 'resetPassword' ? (
            <button
              type="button"
              className="auth-link"
              onClick={() => {
                setMode(mode === 'signIn' ? 'signUp' : 'signIn')
                setError('')
                setSuccess('')
              }}
            >
              {mode === 'signIn' ? 'Регистрация' : 'Войти'}
            </button>
          ) : (
            <button
              type="button"
              className="auth-link"
              onClick={() => {
                setMode('signIn')
                setError('')
                setSuccess('')
              }}
            >
              Назад
            </button>
          )}
        </div>
        {!isSupabaseConfigured ? (
          <p className="error auth-error">Supabase не настроен.</p>
        ) : null}
      </div>
    </div>
  )
}

export default AuthGate
