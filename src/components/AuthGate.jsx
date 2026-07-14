import { useEffect, useState } from 'react'
import supabase, { isSupabaseConfigured } from '../api/supabaseClient'

function normalizeCredential(value) {
  return String(value || '').trim()
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function translateAuthError(err) {
  const message = String(err?.message || err?.error_description || '').toLowerCase()
  const status = err?.status || err?.code

  if (message.includes('invalid login credentials') || message.includes('invalid_credentials')) {
    return 'Неверный email или пароль. Если аккаунта ещё нет — нажмите «Создать новый аккаунт».'
  }
  if (message.includes('email not confirmed') || message.includes('email_not_confirmed')) {
    return 'Email ещё не подтверждён. В Supabase: Authentication → Providers → Email → Confirm email = OFF, либо подтвердите письмо.'
  }
  if (message.includes('user already registered') || message.includes('already been registered')) {
    return 'Этот email уже зарегистрирован. Войдите или сбросьте пароль.'
  }
  if (message.includes('password') && (message.includes('least') || message.includes('6'))) {
    return 'Пароль должен быть не менее 6 символов'
  }
  if (message.includes('rate limit') || status === 429) {
    return 'Слишком много попыток. Подождите минуту и попробуйте снова.'
  }
  if (err?.message) return err.message
  return 'Ошибка авторизации'
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
          const redirectTo = `${window.location.origin}${window.location.pathname}?reset=1`
          const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo })
          if (resetError) throw resetError
          setSuccess('Письмо для сброса пароля отправлено. Проверьте почту (и папку Спам).')
        } catch (err) {
          setError(translateAuthError(err))
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
            return
          }

          if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
            setError('Этот email уже зарегистрирован. Войдите или сбросьте пароль.')
            setMode('signIn')
            return
          }

          if (data?.user) {
            const { data: signInData, error: signInAfterSignUpError } = await supabase.auth.signInWithPassword({
              email: normalizedEmail,
              password: normalizedPassword,
            })
            if (!signInAfterSignUpError && signInData?.session?.user) {
              onSuccess({
                user: signInData.session.user,
                session: signInData.session,
                fullName: normalizedName,
              })
              return
            }
            setSuccess(
              'Аккаунт создан, но вход сразу не удался. В Supabase выключите Confirm email или подтвердите письмо, затем войдите.',
            )
            setMode('signIn')
            return
          }

          setSuccess('Регистрация отправлена. Попробуйте войти.')
          setMode('signIn')
        }
      } catch (err) {
        setError(translateAuthError(err))
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
            : mode === 'signUp'
              ? 'Создайте аккаунт один раз. После этого входите тем же email и паролем.'
              : 'Сначала зарегистрируйтесь, если входите впервые.'}
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
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {mode !== 'resetPassword' ? (
            <input
              className="auth-input"
              type="password"
              placeholder="Пароль (мин. 6 символов)"
              autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
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
