import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useWorkoutSetDraft } from '../../hooks/useWorkoutSetDraft'
import { completeSet } from '../../lib/workouts/lifecycle'
import type { WorkoutSetView } from '../../lib/workouts/types'
import { NumberField } from './NumberField'

const LOAD_UNITS = ['kg', 'lb'] as const
const DISTANCE_UNITS = ['m', 'km', 'mi'] as const

function numberOrEmpty(value: number | null): string {
  return value === null ? '' : String(value)
}

/** One editable set row: set index, previous/today reps+load, a done toggle, and an optional details disclosure. */
export function SetRow({ set, index }: { set: WorkoutSetView; index: number }) {
  const { draft, setField, flush, error } = useWorkoutSetDraft(set.task.id, set.properties)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const isDone = set.task.status === 'done'
  const hasDetails = draft.rpe !== null || draft.durationSeconds !== null || draft.distance !== null

  const complete = async () => {
    if (isDone) return
    setBusy(true)
    try {
      await flush()
      await completeSet(set.task.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="set-row">
      <div className="set-row-main">
        <div className="set-row-index">{index + 1}</div>

        <label className="set-row-field">
          <input
            className="set-row-input"
            type="number"
            inputMode="numeric"
            aria-label={`Set ${index + 1} reps`}
            value={numberOrEmpty(draft.reps)}
            onChange={(event) => {
              const raw = event.target.value
              setField('reps', raw === '' ? null : Math.max(0, Math.round(Number(raw))))
            }}
          />
          <span className="set-row-unit">reps</span>
        </label>

        <label className="set-row-field">
          <input
            className="set-row-input"
            type="number"
            inputMode="decimal"
            aria-label={`Set ${index + 1} load`}
            value={numberOrEmpty(draft.load)}
            onChange={(event) => {
              const raw = event.target.value
              setField('load', raw === '' ? null : Number(raw))
            }}
          />
          <span className="set-row-unit">{draft.loadUnit ?? 'kg'}</span>
        </label>

        <button
          type="button"
          className={`set-row-done${isDone ? ' is-done' : ''}`}
          disabled={busy || isDone}
          aria-label={isDone ? `Set ${index + 1} done` : `Mark set ${index + 1} done`}
          onClick={() => void complete()}
        >
          <Check size={16} aria-hidden="true" />
        </button>
      </div>

      {error && <p className="workout-inline-error" role="alert">{error}</p>}

      <button
        type="button"
        className="set-row-details-toggle"
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen((open) => !open)}
      >
        <ChevronDown size={13} aria-hidden="true" /> {hasDetails ? 'RPE / duration / distance' : 'More details'}
      </button>

      {detailsOpen && (
        <div className="set-row-details-grid">
          <NumberField label="RPE" value={draft.rpe} min={1} placeholder="1–10" inputMode="decimal" onChange={(next) => setField('rpe', next)} />
          <NumberField label="Duration (s)" value={draft.durationSeconds} placeholder="e.g. 90" integer inputMode="numeric" onChange={(next) => setField('durationSeconds', next)} />
          <NumberField label="Distance" value={draft.distance} placeholder="e.g. 10" inputMode="decimal" onChange={(next) => setField('distance', next)} />
          <label className="number-field">
            <span className="number-field-label">Load unit</span>
            <select className="number-field-input" value={draft.loadUnit ?? ''} onChange={(event) => setField('loadUnit', event.target.value || null)}>
              <option value="">—</option>
              {LOAD_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
            </select>
          </label>
          <label className="number-field">
            <span className="number-field-label">Distance unit</span>
            <select className="number-field-input" value={draft.distanceUnit ?? ''} onChange={(event) => setField('distanceUnit', event.target.value || null)}>
              <option value="">—</option>
              {DISTANCE_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}
