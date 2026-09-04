import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, CheckCircle2, Play, RotateCcw } from 'lucide-react'
import { getWorkout } from '../lib/workouts/selectors'
import {
  ActiveWorkoutConflictError,
  UnresolvedSetsError,
  finishWorkout,
  reopenWorkout,
  startWorkout,
} from '../lib/workouts/lifecycle'
import { EXERCISE_EQUIPMENT_OPTIONS, EXERCISE_MUSCLE_OPTIONS } from '../lib/blockMetadata'
import {
  stripStructuralTag,
  tallyWorkoutSets,
  workoutLensState,
} from '../lib/workouts/presentation'
import { formatShortDate } from '../lib/dates'
import type { WorkoutExerciseView, WorkoutView } from '../lib/workouts/types'

const STATE_LABEL = { planned: 'Planned', active: 'Active', completed: 'Completed', canceled: 'Canceled' } as const

const MUSCLE_LABEL = new Map(EXERCISE_MUSCLE_OPTIONS.map((option) => [option.id, option.label]))
const EQUIPMENT_LABEL = new Map(EXERCISE_EQUIPMENT_OPTIONS.map((option) => [option.id, option.label]))

function exerciseName(exercise: WorkoutExerciseView): string {
  return exercise.exerciseThread?.title || stripStructuralTag(exercise.task.text, 'exercise') || 'Exercise'
}

function exerciseSetSummary(exercise: WorkoutExerciseView): string {
  const sets = exercise.sets
  if (sets.length === 0) return 'No sets yet'
  const first = sets[0].properties
  const reps = first.get('set-reps')
  const load = first.get('set-load')
  const unit = first.get('set-load-unit')
  const parts = [`${sets.length} × ${typeof reps === 'number' ? reps : '—'}`]
  if (typeof load === 'number') parts.push(`@ ${load}${typeof unit === 'string' ? unit : 'kg'}`)
  return parts.join(' ')
}

function exerciseMetaLine(exercise: WorkoutExerciseView): string {
  const guide = exercise.guide
  if (!guide) return ''
  const muscle = guide.primaryMuscles[0]
  const equipment = guide.equipment[0]
  return [muscle && (MUSCLE_LABEL.get(muscle) ?? muscle), equipment && (EQUIPMENT_LABEL.get(equipment) ?? equipment)]
    .filter(Boolean)
    .join(' · ')
}

function whySessionCopy(view: WorkoutView): { summary: string; bullets: string[] } {
  const tally = tallyWorkoutSets(view)
  return {
    summary: `This session was put together to keep you moving toward your training goals — ${view.exercises.length} exercise${view.exercises.length === 1 ? '' : 's'} covering ${tally.total} planned set${tally.total === 1 ? '' : 's'}. Placeholder rationale until AI-generated session notes are wired in.`,
    bullets: [
      `Scheduled for ${formatShortDate(view.task.day)}.`,
      'Balanced session chosen to cover multiple movement patterns without overloading any one area.',
      'Adjust load or reps as needed — this plan is a starting point, not a fixed prescription.',
    ],
  }
}

export function WorkoutOverviewPage() {
  const { day = '', blockId = '' } = useParams()
  const navigate = useNavigate()
  const view = useLiveQuery(async () => (blockId ? (await getWorkout(blockId)) ?? null : null), [blockId])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflictId, setConflictId] = useState<string | null>(null)

  if (view === undefined) return <div className="page-loading">Loading workout…</div>

  if (view === null) {
    return (
      <div className="workout-overview-page">
        <Link to={day ? `/?date=${day}` : '/'} className="back-link"><ArrowLeft size={15} /> Back</Link>
        <p className="section-empty">This block is not a workout, or it no longer exists.</p>
      </div>
    )
  }

  const state = workoutLensState(view)
  const title = view.thread?.title || stripStructuralTag(view.task.text, 'workout') || 'Workout'
  const why = whySessionCopy(view)
  const activeHref = `/workout/${day}/${blockId}`

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

  const enter = () => guard(async () => {
    if (state === 'planned') await startWorkout(view.task.id)
    navigate(activeHref)
  })

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
    <article className="workout-overview-page">
      <Link to="/workouts" className="back-link"><ArrowLeft size={15} /> Workouts</Link>

      <header className="workout-overview-head">
        <div className={`workout-state-badge state-${state}`}>{STATE_LABEL[state]}</div>
        <p className="workout-eyebrow">{formatShortDate(view.task.day)}</p>
        <h1 className="workout-title">{title}</h1>
      </header>

      <section className="why-session-card">
        <h2 className="why-session-heading">Why this session</h2>
        <p className="why-session-summary">{why.summary}</p>
        <ul className="why-session-bullets">
          {why.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
        </ul>
      </section>

      <section className="overview-exercise-list">
        <div className="overview-exercise-list-head">
          <h2>Exercises</h2>
          <span>{view.exercises.length} movement{view.exercises.length === 1 ? '' : 's'}</span>
        </div>
        {view.exercises.map((exercise) => {
          const image = exercise.guide?.imageUrls[0]
          return (
            <div className="overview-exercise-row" key={exercise.task.id}>
              <div className="overview-exercise-thumb">
                {image ? <img src={image} alt="" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : null}
              </div>
              <div className="overview-exercise-info">
                <span className="overview-exercise-name">{exerciseName(exercise)}</span>
                <span className="overview-exercise-summary">{exerciseSetSummary(exercise)}</span>
                {exerciseMetaLine(exercise) && <span className="overview-exercise-meta">{exerciseMetaLine(exercise)}</span>}
              </div>
            </div>
          )
        })}
      </section>

      {error && (
        <p className="workout-header-error" role="alert">
          {error}
          {conflictId && <> <Link to={`/workout/${day}/${conflictId}/overview`}>Open it</Link></>}
        </p>
      )}

      <div className="workout-overview-actions">
        {(state === 'planned' || state === 'active') && (
          <button type="button" className="primary-button workout-overview-cta" disabled={busy} onClick={() => void enter()}>
            <Play size={15} aria-hidden="true" /> {state === 'active' ? 'Resume workout' : 'Start workout'}
          </button>
        )}
        {state === 'active' && (
          <button type="button" className="text-button workout-overview-secondary" disabled={busy} onClick={() => void finish()}>
            <CheckCircle2 size={14} aria-hidden="true" /> Finish workout
          </button>
        )}
        {(state === 'completed' || state === 'canceled') && (
          <>
            <Link to={activeHref} className="primary-button workout-overview-cta">Review workout</Link>
            <button type="button" className="text-button workout-overview-secondary" disabled={busy} onClick={() => void guard(() => reopenWorkout(view.task.id))}>
              <RotateCcw size={14} aria-hidden="true" /> Reopen
            </button>
          </>
        )}
      </div>
    </article>
  )
}
