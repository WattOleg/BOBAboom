import { useEffect, useRef, useState } from 'react'
import { uploadCardPhoto } from '../api/supabaseClient'
import { getPhotoCandidates, normalizePhotoUrl } from '../utils/photoUrl'

function EditOverlay({ isOpen, card, categories, onClose, onSave }) {
  const [form, setForm] = useState(null)
  const [saved, setSaved] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoUploadError, setPhotoUploadError] = useState('')
  const [photoPreviewBroken, setPhotoPreviewBroken] = useState(false)
  const galleryInputRef = useRef(null)
  const cameraInputRef = useRef(null)

  useEffect(() => {
    if (card) setForm(card)
    setSaved(false)
    setSubmitError('')
    setIsSubmitting(false)
    setPhotoUploading(false)
    setPhotoUploadError('')
    setPhotoPreviewBroken(false)
  }, [card, isOpen])

  const photoPreviewUrl = form?.photoUrl ? getPhotoCandidates(normalizePhotoUrl(form.photoUrl))[0] || '' : ''

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

  const handlePhotoAttach = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setPhotoUploadError('Выберите файл изображения (JPG, PNG, WebP…)')
      event.target.value = ''
      return
    }

    try {
      setPhotoUploading(true)
      setPhotoUploadError('')
      setPhotoPreviewBroken(false)
      const uploadedUrl = await uploadCardPhoto(file, { sheetName: form?.sheetName })
      setField('photoUrl', uploadedUrl)
    } catch (err) {
      setPhotoUploadError(err?.message || 'Не удалось загрузить фото')
    } finally {
      setPhotoUploading(false)
      event.target.value = ''
    }
  }

  const clearPhoto = () => {
    setField('photoUrl', '')
    setPhotoUploadError('')
    setPhotoPreviewBroken(false)
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
          Фото
          <div className="photo-field">
            <input
              value={form.photoUrl || ''}
              onChange={(e) => {
                setPhotoPreviewBroken(false)
                setField('photoUrl', e.target.value)
              }}
              onBlur={(e) => setField('photoUrl', normalizePhotoUrl(e.target.value))}
              placeholder="URL или прикрепите файл с устройства"
            />
            <div className="photo-field-actions">
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                className="photo-file-input"
                onChange={handlePhotoAttach}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="photo-file-input"
                onChange={handlePhotoAttach}
              />
              <button
                type="button"
                className="ghost-btn photo-attach-btn"
                disabled={photoUploading}
                onClick={() => galleryInputRef.current?.click()}
              >
                {photoUploading ? 'Загрузка…' : 'Из галереи'}
              </button>
              <button
                type="button"
                className="ghost-btn photo-attach-btn"
                disabled={photoUploading}
                onClick={() => cameraInputRef.current?.click()}
              >
                Камера
              </button>
              {form.photoUrl ? (
                <button type="button" className="ghost-btn photo-clear-btn" disabled={photoUploading} onClick={clearPhoto}>
                  Убрать
                </button>
              ) : null}
            </div>
            {photoPreviewUrl && !photoPreviewBroken ? (
              <img
                className="photo-field-preview"
                src={photoPreviewUrl}
                alt="Превью фото техкарты"
                onError={() => setPhotoPreviewBroken(true)}
              />
            ) : null}
            {photoPreviewBroken && form.photoUrl ? (
              <p className="muted">Превью недоступно, но URL сохранён — проверьте ссылку.</p>
            ) : null}
            {photoUploadError ? <p className="error">{photoUploadError}</p> : null}
            <p className="muted photo-field-hint">Фото сохраняется в Supabase Storage и подставляется в поле URL.</p>
          </div>
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
