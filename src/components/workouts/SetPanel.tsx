import { useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { useWorkoutSetDraft } from '../../hooks/useWorkoutSetDraft'
import type { WorkoutSetView } from '../../lib/workouts/types'
import { SetStepper } from './SetStepper'

const LOAD_UNITS = ['kg', 'lb'] as const
const DISTANCE_UNITS = ['m', 'km', 'mi'] as const

function Readout({ value, unit, caption }: { value: number | null; unit?: string; caption: string }) {
  return (
    <div className="set-readout-cell">
      <div className="set-readout-value">
        <span>{value ?? '—'}</span>
        {unit && value !== null && <small>{unit}</small>}
      </div>
      <span className="set-readout-caption">{caption}</span>
    </div>
  )
}

export function SetPanel({
  set,
  detailsOpen,
  onToggleDetails,
  onRegisterFlush,
}: {
  set: WorkoutSetView
  detailsOpen: boolean
  onToggleDetails: () => void
  onRegisterFlush: (flush: () => Promise<void>) => void
}) {
  const { draft, setField, flush, error } = useWorkoutSetDraft(set.task.id, set.properties)

  // Expose this set's flush to the page-level Complete-set bar. Each set's
  // SetPanel is keyed, so the mounted one always re-registers its own flush.
  useEffect(() => {
    onRegisterFlush(flush)
  }, [flush, onRegisterFlush])

  return (
    <div className="set-panel">
      <div className="set-readout">
        <Readout value={draft.load} unit={draft.loadUnit ?? 'kg'} caption="load" />
        <span className="set-readout-sep" aria-hidden="true">×</span>
        <Readout value={draft.reps} caption="reps" />
        <span className="set-readout-sep" aria-hidden="true">·</span>
        <Readout value={draft.rpe} caption="RPE" />
      </div>

      <div className="set-steppers">
        <SetStepper
          label={`Load (${draft.loadUnit ?? 'kg'})`}
          value={draft.load}
          step={2.5}
          inputMode="decimal"
          onChange={(next) => setField('load', next)}
        />
        <SetStepper
          label="Reps"
          value={draft.reps}
          step={1}
          integer
          inputMode="numeric"
          onChange={(next) => setField('reps', next)}
        />
        <SetStepper
          label="RPE"
          value={draft.rpe}
          step={0.5}
          min={1}
          max={10}
          inputMode="decimal"
          onChange={(next) => setField('rpe', next)}
        />
      </div>

      {error && <p className="workout-inline-error" role="alert">{error}</p>}

      <button
        type="button"
        className="set-details-toggle"
        aria-expanded={detailsOpen}
        onClick={onToggleDetails}
      >
        <ChevronDown size={15} aria-hidden="true" /> More details
      </button>

      {detailsOpen && (
        <div className="set-details-grid">
          <SetStepper
            label="Duration (s)"
            value={draft.durationSeconds}
            step={5}
            inputMode="numeric"
            onChange={(next) => setField('durationSeconds', next)}
          />
          <SetStepper
            label="Distance"
            value={draft.distance}
            step={1}
            inputMode="decimal"
            onChange={(next) => setField('distance', next)}
          />
          <label className="field set-details-field">
            <span className="field-label">Load unit</span>
            <select
              className="field-control"
              value={draft.loadUnit ?? ''}
              onChange={(event) => setField('loadUnit', event.target.value || null)}
            >
              <option value="">—</option>
              {LOAD_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
            </select>
          </label>
          <label className="field set-details-field">
            <span className="field-label">Distance unit</span>
            <select
              className="field-control"
              value={draft.distanceUnit ?? ''}
              onChange={(event) => setField('distanceUnit', event.target.value || null)}
            >
              <option value="">—</option>
              {DISTANCE_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}
