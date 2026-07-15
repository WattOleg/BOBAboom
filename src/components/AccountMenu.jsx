import { useEffect, useRef, useState } from 'react'

function getInitials(fullName, email) {
  const name = String(fullName || '').trim()
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    return name.slice(0, 2).toUpperCase()
  }
  const mail = String(email || '').trim()
  return mail ? mail.slice(0, 2).toUpperCase() : '?'
}

function AccountMenu({ auth }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!auth) return null

  if (!auth.isAuthenticated) {
    return (
      <button type="button" className="account-login-btn" onClick={auth.onSignIn} aria-label="Войти">
        Войти
      </button>
    )
  }

  const displayName = String(auth.fullName || '').trim() || String(auth.email || '').split('@')[0] || 'Пользователь'
  const roleLabel = auth.isAdmin ? 'Админ' : 'Сотрудник'
  const initials = getInitials(auth.fullName, auth.email)

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        type="button"
        className={`account-chip ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Личный кабинет"
        title={displayName}
      >
        <span className="account-avatar" aria-hidden>
          {initials}
        </span>
      </button>

      {open ? (
        <div className="account-panel" role="dialog" aria-label="Личный кабинет">
          <div className="account-panel-head">
            <span className="account-avatar account-avatar-lg" aria-hidden>
              {initials}
            </span>
            <div className="account-panel-meta">
              <strong className="account-panel-name">{displayName}</strong>
              <span className="account-panel-email">{auth.email}</span>
              <span className={`account-role-pill ${auth.isAdmin ? 'is-admin' : ''}`}>{roleLabel}</span>
            </div>
          </div>

          <div className="account-panel-actions">
            <button
              type="button"
              className="btn btn-outline-black account-signout-btn"
              onClick={async () => {
                setOpen(false)
                await auth.onSignOut?.()
              }}
            >
              Выйти
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default AccountMenu
