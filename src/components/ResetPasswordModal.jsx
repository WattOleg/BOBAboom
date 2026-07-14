import { useEffect, useState } from 'react'
import supabase from '../api/supabaseClient'

function ResetPasswordModal({ isOpen, onSuccess, onClose }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setPassword('')
      setConfirmPassword('')
      setError('')
      setSubmitting(false)
    }
  }, [isOpen])

  if (!isOpen) return null

  const submit = async (event) => {
    event.preventDefault()
    const nextPassword = String(password || '').trim()
    const nextConfirm = String(confirmPassword || '').trim()

    if (nextPassword.length < 6) {
      setError('Пароль должен быть не менее 6 символов')
      return
    }
    if (nextPassword !== nextConfirm) {
      setError('Пароли не совпадают')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: nextPassword })
      if (updateError) throw updateError
      onSuccess()
    } catch (err) {
      setError(err?.message || 'Не удалось обновить пароль')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="pin-backdrop">
      <div className="pin-modal auth-modal" onClick={(event) => event.stopPropagation()}>
        <h3>Новый пароль</h3>
        <p className="muted auth-hint">Установите новый пароль для входа в BB.</p>
        <form onSubmit={submit} className="auth-form">
          <input
            className="auth-input"
            type="password"
            autoFocus
            placeholder="Новый пароль"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <input
            className="auth-input"
            type="password"
            placeholder="Повторите пароль"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          <button type="submit" className="btn btn-dark auth-submit" disabled={submitting}>
            {submitting ? 'Сохраняем...' : 'Сохранить пароль'}
          </button>
          {error ? <p className="error auth-error">{error}</p> : null}
        </form>
        <button type="button" className="ghost-btn auth-toggle" onClick={onClose}>
          Отмена
        </button>
      </div>
    </div>
  )
}

export default ResetPasswordModal
