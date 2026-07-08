import { useEffect, useState } from 'react'
import { normalizePhotoUrl } from '../utils/photoUrl'

function EditOverlay({ isOpen, card, categories, onClose, onSave }) {
  const [form, setForm] = useState(null)
  const [saved, setSaved] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (card) setForm(card)
    setSaved(false)
    setSubmitError('')
    setIsSubmitting(false)
  }, [card, isOpen])

  if (!form) return null

  const setField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const setIngredient = (index, field, value) => {
    setForm((prev) => {
      const next = [...(prev.ingredients || [])]
      next[index] = { ...next[index], [field]: value }
      return { ...prev, ingredients: next }
    })
  }

  const addIngredient = () => {
    setForm((prev) => ({
      ...prev,
      ingredients: [...(prev.ingredients || []), { name: '', amount: '' }],
    }))
  }

  const removeIngredient = (index) => {
    setForm((prev) => ({
      ...prev,
      ingredients: (prev.ingredients || []).filter((_, i) => i !== index),
    }))
  }

  const submit = async (e) => {
    e.preventDefault()
    try {
      setIsSubmitting(true)
      setSubmitError('')
      await onSave(form)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch (err) {
      setSubmitError(err.message || 'Ошибка сохранения')
    } finally {
      setIsSubmitting(false)
    }
  }

  const isCreate = !card?.sheetName

  return (
    <div className={`edit-overlay ${isOpen ? 'open' : ''}`} aria-hidden={!isOpen}>
      <form className="edit-form" onSubmit={submit}>
        <button type="button" className="close-btn" onClick={onClose} disabled={isSubmitting}>
          ×
        </button>

        <h3>{isCreate ? 'Новая техкарта' : 'Редактирование'}</h3>

        <label>
          ID листа (sheetName)
          <input
            value={form.sheetName || ''}
            onChange={(e) => setField('sheetName', e.target.value)}
            placeholder="Например: Espresso-300"
          />
        </label>

        <label>Название<input value={form.name || ''} onChange={(e) => setField('name', e.target.value)} /></label>
        <label>Название RU<input value={form.nameRu || ''} onChange={(e) => setField('nameRu', e.target.value)} /></label>
        <label>
          Категория
          <input
            value={form.category || ''}
            onChange={(e) => setField('category', e.target.value)}
            list="category-options"
            placeholder="Введите категорию"
          />
          <datalist id="category-options">
            {categories.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </label>
        <label>Выход<input value={form.yield || ''} onChange={(e) => setField('yield', e.target.value)} /></label>
        <label>Время<input value={form.time || ''} onChange={(e) => setField('time', e.target.value)} /></label>
        <label>Метод<input value={form.method || ''} onChange={(e) => setField('method', e.target.value)} /></label>
        <label>Бокал<input value={form.glass || ''} onChange={(e) => setField('glass', e.target.value)} /></label>
        <label>Украшение<input value={form.garnish || ''} onChange={(e) => setField('garnish', e.target.value)} /></label>
        <label>
          Фото URL
          <input
            value={form.photoUrl || ''}
            onChange={(e) => setField('photoUrl', e.target.value)}
            onBlur={(e) => setField('photoUrl', normalizePhotoUrl(e.target.value))}
          />
        </label>
        <label>
          Технология
          <textarea value={form.technology || ''} onChange={(e) => setField('technology', e.target.value)} />
        </label>

        <div className="ing-head">
          <h4>Ингредиенты</h4>
          <button type="button" className="ghost-btn" onClick={addIngredient}>
            + Добавить
          </button>
        </div>
        <div className="ing-list">
          {(form.ingredients || []).map((ing, index) => (
            <div key={index} className="ing-item">
              <input
                placeholder="Название"
                value={ing.name || ''}
                onChange={(e) => setIngredient(index, 'name', e.target.value)}
              />
              <input
                placeholder="Кол-во"
                value={ing.amount || ''}
                onChange={(e) => setIngredient(index, 'amount', e.target.value)}
              />
              <button type="button" className="ghost-btn" onClick={() => removeIngredient(index)}>
                Удалить
              </button>
            </div>
          ))}
        </div>

        <button type="submit" className="btn btn-dark save-btn" disabled={isSubmitting}>
          {isSubmitting
            ? 'Сохранение...'
            : saved
              ? '✓ Сохранено'
              : isCreate
                ? 'Создать в BB'
                : 'Сохранить в BB'}
        </button>
        {isSubmitting ? <p className="muted">Идет связь с сервером...</p> : null}
        {submitError ? <p className="error">{submitError}</p> : null}
      </form>
    </div>
  )
}

export default EditOverlay
