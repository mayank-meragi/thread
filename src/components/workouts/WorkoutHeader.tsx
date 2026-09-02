import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ExternalLink, Play, RotateCcw, Timer } from 'lucide-react'
import {
  ActiveWorkoutConflictError,
  UnresolvedSetsError,
  finishWorkout,
  reopenWorkout,
  startWorkout,
} from '../../lib/workouts/lifecycle'
import {
  elapsedMs,
  formatDuration,
  sourceHref,
  stripStructuralTag,
  tallyWorkoutSets,
  workoutLensState,
} from '../../lib/workouts/presentation'
import { formatShortDate } from '../../lib/dates'
import type { WorkoutView } from '../../lib/workouts/types'

const STATE_LABEL: Record<ReturnType<typeof workoutLensState>, string> = {
  planned: 'Planned',
  active: 'Active',
  completed: 'Completed',
  canceled: 'Canceled',
}

export function WorkoutHeader({ view }: { view: WorkoutView }) {
  const state = workoutLensState(view)
  const tally = tallyWorkoutSets(view)
  const label = useMemo(
    () => view.thread?.title || stripStructuralTag(view.task.text, 'workout') || 'Workout',
    [view.thread, view.task.text],
  )
  const threadSlug = view.thread?.id
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState<string | null>(null)
  const [conflictId, setConflictId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (state !== 'active') return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [state])

  const elapsed = elapsedMs(view, now)

  const guard = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    setConflictId(null)
    try {
      await action()
    } catch (caught) {
      if (caught instanceof ActiveWorkoutConflictError) {
        setConflictId(caught.conflict.activeWorkoutTaskId)
        setError('Another workout is already in progress.')
      } else {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    } finally {
      setBusy(false)
    }
  }

  const finish = () => guard(async () => {
    try {
      await finishWorkout(view.task.id)
    } catch (caught) {
      if (!(caught instanceof UnresolvedSetsError)) throw caught
      const cancel = window.confirm(
        `${caught.setTaskIds.length} set${caught.setTaskIds.length === 1 ? '' : 's'} still unresolved. Mark them skipped? (Cancel keeps them pending.)`,
      )
      await finishWorkout(view.task.id, { unresolvedSets: cancel ? 'cancel' : 'leave' })
    }
  })

  return (
    <header className="workout-header">
      <div className="workout-header-top">
        <div className="workout-header-heading">
          <div className={`workout-state-badge state-${state}`}>{STATE_LABEL[state]}</div>
          <p className="workout-eyebrow">{view.task.day ? formatShortDate(view.task.day) : 'Workout'}</p>
          <h1 className="workout-title">
            {threadSlug ? <Link to={`/thread/${threadSlug}`}>{label}</Link> : label}
          </h1>
        </div>
        <a className="icon-button" aria-label="Open source line" href={sourceHref(view.task)}>
          <ExternalLink size={16} aria-hidden="true" />
        </a>
      </div>

      <div className="workout-header-stats">
        <span>{tally.completed}/{tally.total} sets</span>
        {tally.skipped > 0 && <span>{tally.skipped} skipped</span>}
        {elapsed !== undefined && (
          <span className="workout-elapsed"><Timer size={13} aria-hidden="true" /> {formatDuration(elapsed)}</span>
        )}
      </div>

      <div className="workout-header-actions">
        {state === 'planned' && (
          <button type="button" className="primary-button" disabled={busy} onClick={() => void guard(() => startWorkout(view.task.id))}>
            <Play size={14} aria-hidden="true" /> Start workout
          </button>
        )}
        {state === 'active' && (
          <button type="button" className="primary-button" disabled={busy} onClick={() => void finish()}>
            <CheckCircle2 size={14} aria-hidden="true" /> Finish workout
          </button>
        )}
        {(state === 'completed' || state === 'canceled') && (
          <button type="button" className="text-button" disabled={busy} onClick={() => void guard(() => reopenWorkout(view.task.id))}>
            <RotateCcw size={14} aria-hidden="true" /> Reopen
          </button>
        )}
      </div>

      {error && (
        <p className="workout-header-error" role="alert">
          {error}
          {conflictId && <> <a href={`#/?block=${conflictId}`}>Open it</a></>}
        </p>
      )}
    </header>
  )
}
