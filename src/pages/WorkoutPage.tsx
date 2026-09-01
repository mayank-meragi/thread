import { useCallback, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Plus } from 'lucide-react'
import { addExercise } from '../lib/workouts/mutations'
import { getWorkout } from '../lib/workouts/selectors'
import { nextActionableSetId } from '../lib/workouts/presentation'
import { WorkoutHeader } from '../components/workouts/WorkoutHeader'
import { WorkoutDiagnostics } from '../components/workouts/WorkoutDiagnostics'
import { ExerciseCard } from '../components/workouts/ExerciseCard'

export function WorkoutPage() {
  const { day = '', blockId = '' } = useParams()
  // `undefined` = still loading; `null` = resolved, but this block is not a workout.
  const view = useLiveQuery(async () => (blockId ? (await getWorkout(blockId)) ?? null : null), [blockId])

  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set())
  const [exerciseTitle, setExerciseTitle] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addingExercise, setAddingExercise] = useState(false)

  const toggleSet = useCallback((setId: string) => {
    setExpandedSets((current) => {
      const next = new Set(current)
      if (next.has(setId)) next.delete(setId)
      else next.add(setId)
      return next
    })
  }, [])

  const advance = useCallback((nextSetId: string | undefined) => {
    if (!nextSetId) return
    setExpandedSets((current) => new Set(current).add(nextSetId))
  }, [])

  const submitExercise = async () => {
    if (!view || !exerciseTitle.trim()) return
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

  if (view === undefined) return <div className="page-loading">Loading workout…</div>

  if (view === null) {
    return (
      <div className="workout-page">
        <Link to={day ? `/?date=${day}` : '/'} className="back-link"><ArrowLeft size={15} /> Back</Link>
        <p className="section-empty">This block is not a workout, or it no longer exists.</p>
      </div>
    )
  }

  const nextId = nextActionableSetId(view)

  return (
    <article className="workout-page">
      <Link to={`/?date=${view.task.day}&block=${view.task.id}`} className="back-link"><ArrowLeft size={15} /> Outline</Link>

      <WorkoutDiagnostics diagnostics={view.diagnostics} />
      <WorkoutHeader view={view} />

      {nextId && (
        <p className="workout-next-hint">
          Next up: <button type="button" className="link-button" onClick={() => advance(nextId)}>open the next set</button>
        </p>
      )}

      <div className="exercise-list">
        {view.exercises.map((exercise) => (
          <ExerciseCard
            key={exercise.task.id}
            exercise={exercise}
            expandedSets={expandedSets}
            onToggleSet={toggleSet}
            onAdvance={advance}
          />
        ))}
        {view.exercises.length === 0 && <p className="section-empty">No exercises yet — add the first one below.</p>}
      </div>

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
    </article>
  )
}
