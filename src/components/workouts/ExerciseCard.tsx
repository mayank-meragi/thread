import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ExternalLink, Plus, SkipForward, Trash2 } from 'lucide-react'
import { addSet, deleteWorkoutItem, skipExercise } from '../../lib/workouts/mutations'
import { exerciseSummary, sourceHref, stripStructuralTag } from '../../lib/workouts/presentation'
import type { WorkoutExerciseView } from '../../lib/workouts/types'
import { SetRow } from './SetRow'

export function ExerciseCard({
  exercise,
  expandedSets,
  onToggleSet,
  onAdvance,
}: {
  exercise: WorkoutExerciseView
  expandedSets: Set<string>
  onToggleSet: (setId: string) => void
  onAdvance: (nextSetId: string | undefined) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { tally, complete } = exerciseSummary(exercise)
  const name = exercise.exerciseThread?.title
    || stripStructuralTag(exercise.task.text, 'exercise')
    || 'Exercise'

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`exercise-card${complete ? ' is-complete' : ''}${exercise.task.status === 'canceled' ? ' is-skipped' : ''}`}>
      <header className="exercise-card-head">
        <div className="exercise-card-title">
          {complete && <CheckCircle2 size={16} aria-hidden="true" />}
          {exercise.exerciseThread
            ? <Link to={`/thread/${exercise.exerciseThread.id}`}>{name}</Link>
            : <span>{name}</span>}
        </div>
        <div className="exercise-card-meta">
          <span>{tally.completed}/{tally.total} sets</span>
          <a className="icon-button" aria-label="Open source line" href={sourceHref(exercise.task)}><ExternalLink size={14} aria-hidden="true" /></a>
          <button type="button" className="icon-button" aria-label="Skip exercise" disabled={busy || exercise.task.status === 'canceled'} onClick={() => void run(() => skipExercise(exercise.task.id))}>
            <SkipForward size={14} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" aria-label="Delete exercise" disabled={busy} onClick={() => void run(() => deleteWorkoutItem(exercise.task.id))}>
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      </header>

      {error && <p className="exercise-card-error" role="alert">{error}</p>}

      <ul className="set-list">
        {exercise.sets.map((set) => (
          <SetRow
            key={set.task.id}
            set={set}
            expanded={expandedSets.has(set.task.id)}
            onToggleExpanded={() => onToggleSet(set.task.id)}
            onAdvance={onAdvance}
          />
        ))}
        {exercise.sets.length === 0 && <li className="section-empty">No sets yet</li>}
      </ul>

      <button type="button" className="text-button add-set-button" disabled={busy} onClick={() => void run(() => addSet(exercise.task.id))}>
        <Plus size={14} aria-hidden="true" /> Add set
      </button>

      {exercise.notes.map((note) => (
        <p key={note.id} className="exercise-note">{note.plainText}</p>
      ))}
    </section>
  )
}
