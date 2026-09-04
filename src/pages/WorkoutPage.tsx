import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { addExercise } from '../lib/workouts/mutations'
import { getWorkout } from '../lib/workouts/selectors'
import { stripStructuralTag } from '../lib/workouts/presentation'
import { WorkoutDiagnostics } from '../components/workouts/WorkoutDiagnostics'
import { ActiveExercise } from '../components/workouts/ActiveExercise'
import { ExerciseTopBar } from '../components/workouts/ExerciseTopBar'

const SWIPE_THRESHOLD_PX = 50

export function WorkoutPage() {
  const { day = '', blockId = '' } = useParams()
  const navigate = useNavigate()
  // `undefined` = still loading; `null` = resolved, but this block is not a workout.
  const view = useLiveQuery(async () => (blockId ? (await getWorkout(blockId)) ?? null : null), [blockId])

  const [index, setIndex] = useState(0)
  const [exerciseTitle, setExerciseTitle] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addingExercise, setAddingExercise] = useState(false)
  const touchStartX = useRef<number | null>(null)

  const overviewHref = `/workout/${day}/${blockId}/overview`

  if (view === undefined) return <div className="page-loading">Loading workout…</div>

  if (view === null) {
    return (
      <div className="workout-page">
        <Link to={day ? `/?date=${day}` : '/'} className="back-link">Back</Link>
        <p className="section-empty">This block is not a workout, or it no longer exists.</p>
      </div>
    )
  }

  const exercises = view.exercises
  const clampedIndex = Math.min(index, Math.max(exercises.length - 1, 0))
  const current = exercises[clampedIndex]
  const title = view.thread?.title || stripStructuralTag(view.task.text, 'workout') || 'Workout'

  const goTo = (next: number) => {
    setIndex(Math.max(0, Math.min(next, exercises.length - 1)))
  }

  const onTouchStart = (event: React.TouchEvent) => {
    touchStartX.current = event.touches[0]?.clientX ?? null
  }
  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touchStartX.current
    touchStartX.current = null
    const end = event.changedTouches[0]?.clientX
    if (start === null || end === undefined) return
    const delta = end - start
    if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return
    goTo(clampedIndex + (delta < 0 ? 1 : -1))
  }

  const submitExercise = async () => {
    if (!exerciseTitle.trim()) return
    setAddingExercise(true)
    setAddError(null)
    try {
      await addExercise(view.task.id, exerciseTitle)
      setExerciseTitle('')
    } catch (caught) {
      setAddError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setAddingExercise(false)
    }
  }

  return (
    <article className="workout-page">
      <ExerciseTopBar title={title} backHref={overviewHref} index={clampedIndex} total={Math.max(exercises.length, 1)} />

      <WorkoutDiagnostics diagnostics={view.diagnostics} />

      {exercises.length > 0 ? (
        <div className="exercise-swipe-area" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <ActiveExercise key={current.task.id} exercise={current} index={clampedIndex} />
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

      {exercises.length > 1 && (
        <div className="exercise-pager">
          <button type="button" disabled={clampedIndex === 0} onClick={() => goTo(clampedIndex - 1)}>Previous</button>
          <button type="button" disabled={clampedIndex === exercises.length - 1} onClick={() => goTo(clampedIndex + 1)}>Next exercise</button>
        </div>
      )}

      <button type="button" className="text-button workout-page-finish" onClick={() => navigate(overviewHref)}>
        Back to overview
      </button>
    </article>
  )
}
