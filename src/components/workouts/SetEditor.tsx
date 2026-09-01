import { useState } from 'react'
import { Check } from 'lucide-react'
import type { PropertyValue } from '../../db'
import { updateSet, type SetPropertyInput } from '../../lib/workouts/mutations'

const LOAD_UNITS = ['kg', 'lb'] as const
const DISTANCE_UNITS = ['m', 'km', 'mi'] as const

type FieldKey = keyof SetPropertyInput

const NUMBER_FIELDS: Array<{ key: FieldKey; label: string; propertyId: string; step?: string; inputMode: 'decimal' | 'numeric' }> = [
  { key: 'load', label: 'Load', propertyId: 'set-load', step: 'any', inputMode: 'decimal' },
  { key: 'reps', label: 'Reps', propertyId: 'set-reps', step: '1', inputMode: 'numeric' },
  { key: 'rpe', label: 'RPE', propertyId: 'set-rpe', step: '0.5', inputMode: 'decimal' },
  { key: 'durationSeconds', label: 'Duration (s)', propertyId: 'set-duration-seconds', step: 'any', inputMode: 'numeric' },
  { key: 'distance', label: 'Distance', propertyId: 'set-distance', step: 'any', inputMode: 'decimal' },
]

function initialText(properties: Map<string, PropertyValue>, propertyId: string): string {
  const value = properties.get(propertyId)
  return typeof value === 'number' || typeof value === 'string' ? String(value) : ''
}

function toInput(form: Record<string, string>): SetPropertyInput {
  const number = (raw: string): number | null => {
    const trimmed = raw.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    if (Number.isNaN(parsed)) throw new Error('Enter a number, or leave the field blank.')
    return parsed
  }
  return {
    load: number(form.load),
    loadUnit: form.loadUnit || null,
    reps: number(form.reps),
    rpe: number(form.rpe),
    durationSeconds: number(form.durationSeconds),
    distance: number(form.distance),
    distanceUnit: form.distanceUnit || null,
  }
}

export function SetEditor({
  setTaskId,
  properties,
  onSaved,
}: {
  setTaskId: string
  properties: Map<string, PropertyValue>
  onSaved?: () => void
}) {
  const [form, setForm] = useState<Record<string, string>>({
    load: initialText(properties, 'set-load'),
    loadUnit: initialText(properties, 'set-load-unit'),
    reps: initialText(properties, 'set-reps'),
    rpe: initialText(properties, 'set-rpe'),
    durationSeconds: initialText(properties, 'set-duration-seconds'),
    distance: initialText(properties, 'set-distance'),
    distanceUnit: initialText(properties, 'set-distance-unit'),
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await updateSet(setTaskId, toInput(form))
      onSaved?.()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="set-editor"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="set-editor-grid">
        {NUMBER_FIELDS.map((field) => (
          <label key={field.key} className="set-editor-field">
            <span>{field.label}</span>
            <input
              type="number"
              inputMode={field.inputMode}
              step={field.step}
              min="0"
              value={form[field.key] ?? ''}
              onChange={(event) => update(field.key, event.target.value)}
            />
          </label>
        ))}
        <label className="set-editor-field">
          <span>Load unit</span>
          <select value={form.loadUnit} onChange={(event) => update('loadUnit', event.target.value)}>
            <option value="">—</option>
            {LOAD_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
          </select>
        </label>
        <label className="set-editor-field">
          <span>Distance unit</span>
          <select value={form.distanceUnit} onChange={(event) => update('distanceUnit', event.target.value)}>
            <option value="">—</option>
            {DISTANCE_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="set-editor-error" role="alert">{error}</p>}
      <div className="set-editor-actions">
        <button type="submit" className="primary-button" disabled={saving}>
          <Check size={14} aria-hidden="true" /> {saving ? 'Saving…' : 'Save set'}
        </button>
      </div>
    </form>
  )
}
