import { useEffect, useMemo, useRef, useState } from 'react'
import { getPhotoCandidates } from '../utils/photoUrl'

const SWIPE_START_THRESHOLD = 10
const SWIPE_COMMIT_RATIO = 0.22
const SWIPE_COMMIT_MIN = 72
const SWIPE_COMMIT_MAX = 140

function DetailView({ card, loading, onBack, onEdit, onDelete, onDuplicate, onExport, onShare, onSwipeMove, swipeEnabled = true }) {
  const rootRef = useRef(null)
  const swipeRef = useRef({ startX: 0, startY: 0, active: false, dragging: false })
  const photoCandidates = useMemo(() => getPhotoCandidates(card?.photoUrl), [card?.photoUrl])
  const [photoIdx, setPhotoIdx] = useState(0)
  const [ingredientsExpanded, setIngredientsExpanded] = useState(false)

  useEffect(() => {
    setPhotoIdx(0)
  }, [card?.photoUrl])

  useEffect(() => {
    if (ingredientsExpanded) {
      onSwipeMove?.(0, false)
    }
  }, [ingredientsExpanded, onSwipeMove])

  useEffect(() => {
    const root = rootRef.current
    if (!root || !swipeEnabled) return undefined

    const resetSwipe = () => {
      swipeRef.current = { startX: 0, startY: 0, active: false, dragging: false }
      onSwipeMove?.(0, true)
    }

    const onTouchStart = (event) => {
      if (ingredientsExpanded) return
      const touch = event.changedTouches?.[0]
      if (!touch) return
      swipeRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        active: true,
        dragging: false,
      }
    }

    const onTouchMove = (event) => {
      if (ingredientsExpanded || !swipeRef.current.active) return
      const touch = event.changedTouches?.[0]
      if (!touch) return

      const dx = touch.clientX - swipeRef.current.startX
      const dy = touch.clientY - swipeRef.current.startY

      if (!swipeRef.current.dragging) {
        if (Math.abs(dx) < SWIPE_START_THRESHOLD && Math.abs(dy) < SWIPE_START_THRESHOLD) return
        if (Math.abs(dx) <= Math.abs(dy) * 1.15) {
          swipeRef.current.active = false
          return
        }
        swipeRef.current.dragging = true
      }

      if (dx > 0) {
        event.preventDefault()
        onSwipeMove?.(dx, false)
      }
    }

    const onTouchEnd = (event) => {
      if (!swipeRef.current.active && !swipeRef.current.dragging) return
      const touch = event.changedTouches?.[0]
      if (!touch) {
        resetSwipe()
        return
      }

      const dx = touch.clientX - swipeRef.current.startX
      const commitThreshold = Math.min(
        SWIPE_COMMIT_MAX,
        Math.max(SWIPE_COMMIT_MIN, window.innerWidth * SWIPE_COMMIT_RATIO),
      )

      if (swipeRef.current.dragging && dx >= commitThreshold) {
        onSwipeMove?.(0, true)
        onBack()
      } else {
        resetSwipe()
      }

      swipeRef.current = { startX: 0, startY: 0, active: false, dragging: false }
    }

    root.addEventListener('touchstart', onTouchStart, { passive: true })
    root.addEventListener('touchmove', onTouchMove, { passive: false })
    root.addEventListener('touchend', onTouchEnd, { passive: true })
    root.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      root.removeEventListener('touchstart', onTouchStart)
      root.removeEventListener('touchmove', onTouchMove)
      root.removeEventListener('touchend', onTouchEnd)
      root.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [ingredientsExpanded, onBack, onSwipeMove, swipeEnabled])

  if (!card) {
    return (
      <div className="view detail-view">
        <p className="muted">Выберите карточку</p>
      </div>
    )
  }

  const hasCandidate = photoIdx < photoCandidates.length
  const photoUrl = hasCandidate ? photoCandidates[photoIdx] : ''

  return (
    <div ref={rootRef} className="view detail-view">
      <div className="hero">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={card.name}
            referrerPolicy="no-referrer"
            onError={() =>
              setPhotoIdx((prev) => (prev + 1 <= photoCandidates.length ? prev + 1 : prev))
            }
          />
        ) : (
          <div className="hero-placeholder">🍹</div>
        )}
        <div className="hero-top">
          <button type="button" className="icon-btn" onClick={onBack}>
            ←
          </button>
          <button type="button" className="icon-btn" onClick={onEdit}>
            Изменить
          </button>
        </div>
      </div>

      <p className="detail-swipe-hint muted">Свайп вправо — назад к списку</p>

      <h2 className="title">{card.name}</h2>
      <p className="subtitle">{card.nameRu}</p>

      <div className="meta-row">
        <div className="meta-box">
          <span>Выход</span>
          <strong>{card.yield}</strong>
        </div>
        <div className="meta-box">
          <span>Время</span>
          <strong>{card.time}</strong>
        </div>
        <div className="meta-box">
          <span>Метод</span>
          <strong>{card.method}</strong>
        </div>
      </div>

      <section className="block">
        <h3>Подача</h3>
        <p>{card.glass}</p>
        <p className="muted">{card.garnish}</p>
      </section>

      <section className={`block detail-block ${loading ? 'is-loading' : 'is-ready'}`}>
        <div className="detail-section-head">
          <h3>Ингредиенты</h3>
          <button type="button" className="detail-section-action" onClick={() => setIngredientsExpanded(true)}>
            На весь экран
          </button>
        </div>
        {loading ? <p className="muted">Загружаю детали...</p> : null}
        <div className="ingredient-list">
          {card.ingredients?.map((ing, idx) => (
            <div key={`${ing.name}-${idx}`} className="ingredient-row">
              <span>{ing.name}</span>
              <strong>{ing.amount}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className={`block detail-block ${loading ? 'is-loading' : 'is-ready'}`}>
        <h3>Технология</h3>
        <p>{card.technology}</p>
      </section>

      {ingredientsExpanded ? (
        <div className="ingredients-fullscreen" role="dialog" aria-modal="true" onClick={() => setIngredientsExpanded(false)}>
          <div className="ingredients-fullscreen-card" onClick={(event) => event.stopPropagation()}>
            <div className="detail-section-head ingredients-fullscreen-head">
              <div className="ingredients-fullscreen-title">
                <h3>{card.name}</h3>
                <p className="muted small">Список ингредиентов</p>
              </div>
              <button type="button" className="detail-section-action" onClick={() => setIngredientsExpanded(false)}>
                Закрыть
              </button>
            </div>
            <div className="ingredients-fullscreen-list">
              {(card.ingredients || []).length ? (
                card.ingredients.map((ing, idx) => (
                  <div key={`${ing.name}-${idx}`} className="ingredients-fullscreen-row">
                    <span className="ingredients-fullscreen-name">{ing.name}</span>
                    <strong className="ingredients-fullscreen-amount">{ing.amount}</strong>
                  </div>
                ))
              ) : (
                <p className="muted">Список ингредиентов пуст.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className="actions">
        <button type="button" className="btn btn-dark" onClick={onEdit}>
          Редактировать
        </button>
        <button type="button" className="btn btn-outline-black" onClick={onDuplicate}>
          Дублировать
        </button>
        <div className="actions-inline">
          <button type="button" className="btn btn-compact btn-outline-black" onClick={onExport}>
            Экспорт PDF
          </button>
          <button type="button" className="btn btn-compact btn-outline-black" onClick={onShare}>
            Отправить
          </button>
        </div>
        <button type="button" className="btn btn-danger" onClick={onDelete}>
          Удалить
        </button>
      </div>
    </div>
  )
}

export default DetailView
