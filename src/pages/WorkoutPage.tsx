import { useCallback, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Plus } from 'lucide-react'
import { addExercise } from '../lib/workouts/mutations'
import { getWorkout } from '../lib/workouts/selectors'
import { nextActionableSetId } from '../lib/workouts/presentation'
import type { WorkoutExerciseView, WorkoutView } from '../lib/workouts/types'
import { WorkoutHeader } from '../components/workouts/WorkoutHeader'
import { WorkoutDiagnostics } from '../components/workouts/WorkoutDiagnostics'
import { ActiveExercise } from '../components/workouts/ActiveExercise'
import { CollapsedExercise } from '../components/workouts/CollapsedExercise'
import { CompleteSetBar } from '../components/workouts/CompleteSetBar'

function firstPendingSetId(exercise: WorkoutExerciseView | null): string {
  if (!exercise) return ''
  const pending = exercise.sets.find(
    (set) => set.task.status !== 'done' && set.task.status !== 'canceled',
  )
  return pending?.task.id ?? exercise.sets[exercise.sets.length - 1]?.task.id ?? ''
}

function exerciseOwningSet(view: WorkoutView, setId: string): WorkoutExerciseView | undefined {
  return view.exercises.find((exercise) => exercise.sets.some((set) => set.task.id === setId))
}

export function WorkoutPage() {
  const { day = '', blockId = '' } = useParams()
  // `undefined` = still loading; `null` = resolved, but this block is not a workout.
  const view = useLiveQuery(async () => (blockId ? (await getWorkout(blockId)) ?? null : null), [blockId])

  // The selection is stored as "intent"; the effective ids are derived each
  // render with fallbacks so a deleted/completed target self-heals.
  const [pickedExerciseId, setPickedExerciseId] = useState('')
  const [pickedSetId, setPickedSetId] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [exerciseTitle, setExerciseTitle] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addingExercise, setAddingExercise] = useState(false)
  const flushRef = useRef<() => Promise<void>>(async () => {})
  const registerFlush = useCallback((flush: () => Promise<void>) => {
    flushRef.current = flush
  }, [])

  const exercises = view ? view.exercises : []

  let effectiveExerciseId = ''
  if (exercises.some((exercise) => exercise.task.id === pickedExerciseId)) {
    effectiveExerciseId = pickedExerciseId
  } else if (view) {
    const nextSet = nextActionableSetId(view)
    const owner = nextSet ? exerciseOwningSet(view, nextSet) : undefined
    effectiveExerciseId = owner?.task.id ?? exercises[0]?.task.id ?? ''
  }

  const effectiveExercise = exercises.find((exercise) => exercise.task.id === effectiveExerciseId) ?? null
  const effectiveSetId = effectiveExercise?.sets.some((set) => set.task.id === pickedSetId)
    ? pickedSetId
    : firstPendingSetId(effectiveExercise)
  const effectiveSet = effectiveExercise?.sets.find((set) => set.task.id === effectiveSetId) ?? null

  const selectExercise = (id: string) => {
    setPickedExerciseId(id)
    setPickedSetId('')
  }

  const advance = (nextSetId: string | undefined) => {
    if (!view) return
    if (!nextSetId) {
      // No more actionable sets — stay on the current exercise rather than
      // snapping back to the first one.
      if (effectiveExerciseId) setPickedExerciseId(effectiveExerciseId)
      return
    }
    const owner = exerciseOwningSet(view, nextSetId)
    if (owner) setPickedExerciseId(owner.task.id)
    setPickedSetId(nextSetId)
  }

  const submitExercise = async () => {
    if (!view || !exerciseTitle.trim()) return
    setAddingExercise(true)
    setAddError(null)
    try {
      const id = await addExercise(view.task.id, exerciseTitle)
      setExerciseTitle('')
      if (typeof id === 'string') selectExercise(id)
    } catch (caught) {
      setAddError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setAddingExercise(false)
    }
  }

  if (view === undefined) return <div className="page-loading">Loading workout…</div>

  if (view === null) {
    return (
      <div className="workout-page">
        <Link to={day ? `/?date=${day}` : '/'} className="back-link"><ArrowLeft size={15} /> Back</Link>
        <p className="section-empty">This block is not a workout, or it no longer exists.</p>
      </div>
    )
  }

  return (
    <article className="workout-page">
      <Link to={`/?date=${view.task.day}&block=${view.task.id}`} className="back-link"><ArrowLeft size={15} /> Outline</Link>

      <WorkoutDiagnostics diagnostics={view.diagnostics} />
      <WorkoutHeader view={view} />

      {view.exercises.length > 0 ? (
        <div className="exercise-stack">
          {view.exercises.map((exercise) =>
            exercise.task.id === effectiveExerciseId ? (
              <ActiveExercise
                key={exercise.task.id}
                exercise={exercise}
                selectedSetId={effectiveSetId}
                onSelectSet={setPickedSetId}
                detailsOpen={detailsOpen}
                onToggleDetails={() => setDetailsOpen((open) => !open)}
                onRegisterFlush={registerFlush}
              />
            ) : (
              <CollapsedExercise
                key={exercise.task.id}
                exercise={exercise}
                onExpand={selectExercise}
              />
            ),
          )}
        </div>
      ) : (
        <p className="section-empty">No exercises yet — add the first one below.</p>
      )}

      <form
        className="add-exercise-form"
        onSubmit={(event) => {
          event.preventDefault()
          void submitExercise()
        }}
      >
        <input
          value={exerciseTitle}
          onChange={(event) => setExerciseTitle(event.target.value)}
          placeholder="Add an exercise (e.g. Bench Press)"
          aria-label="Exercise name"
        />
        <button type="submit" className="primary-button" disabled={addingExercise || !exerciseTitle.trim()}>
          <Plus size={14} aria-hidden="true" /> Add
        </button>
      </form>
      {addError && <p className="add-exercise-error" role="alert">{addError}</p>}

      {effectiveSet && (
        <CompleteSetBar
          selectedSetId={effectiveSet.task.id}
          isDone={effectiveSet.task.status === 'done'}
          flush={() => flushRef.current()}
          onAdvance={advance}
        />
      )}
    </article>
  )
}
