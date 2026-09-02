import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, MoreHorizontal, Plus, SkipForward, Trash2 } from 'lucide-react'
import { addSet, deleteWorkoutItem, skipExercise } from '../../lib/workouts/mutations'
import { exerciseSummary, sourceHref, stripStructuralTag } from '../../lib/workouts/presentation'
import type { WorkoutExerciseView } from '../../lib/workouts/types'
import { SetPanel } from './SetPanel'

function exerciseName(exercise: WorkoutExerciseView): string {
  return exercise.exerciseThread?.title
    || stripStructuralTag(exercise.task.text, 'exercise')
    || 'Exercise'
}

export function ActiveExercise({
  exercise,
  selectedSetId,
  onSelectSet,
  detailsOpen,
  onToggleDetails,
  onRegisterFlush,
}: {
  exercise: WorkoutExerciseView
  selectedSetId: string
  onSelectSet: (id: string) => void
  detailsOpen: boolean
  onToggleDetails: () => void
  onRegisterFlush: (flush: () => Promise<void>) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { tally } = exerciseSummary(exercise)

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    setMenuOpen(false)
    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const addAndSelect = () => run(async () => {
    const id = await addSet(exercise.task.id)
    if (typeof id === 'string') onSelectSet(id)
  })

  const selectedIndex = exercise.sets.findIndex((set) => set.task.id === selectedSetId)
  const selectedSet = exercise.sets.find((set) => set.task.id === selectedSetId) ?? null
  const name = exerciseName(exercise)

  return (
    <section className="active-exercise">
      <header className="active-exercise-head">
        <div className="active-exercise-title">
          {exercise.exerciseThread
            ? <Link to={`/thread/${exercise.exerciseThread.id}`}>{name}</Link>
            : <span>{name}</span>}
        </div>
        <div className="active-exercise-meta">
          <span>{tally.completed}/{tally.total} sets</span>
          <div className="active-exercise-menu-anchor">
            <button
              type="button"
              className="icon-button"
              aria-label="Exercise actions"
              aria-expanded={menuOpen}
              disabled={busy}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
            {menuOpen && (
              <>
                <div className="active-exercise-menu-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="menu-panel active-exercise-menu" role="menu">
                  <a className="menu-item" role="menuitem" href={sourceHref(exercise.task)}>
                    <ExternalLink size={15} aria-hidden="true" /> Open source line
                  </a>
                  <button
                    type="button"
                    className="menu-item"
                    role="menuitem"
                    disabled={exercise.task.status === 'canceled'}
                    onClick={() => void run(() => skipExercise(exercise.task.id))}
                  >
                    <SkipForward size={15} aria-hidden="true" /> Skip exercise
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    role="menuitem"
                    onClick={() => void run(() => deleteWorkoutItem(exercise.task.id))}
                  >
                    <Trash2 size={15} aria-hidden="true" /> Delete exercise
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {error && <p className="workout-inline-error" role="alert">{error}</p>}

      {exercise.sets.length === 0 ? (
        <p className="active-exercise-empty">No sets yet — add the first one below.</p>
      ) : (
        <>
          <div className="set-nav">
            <span className="set-nav-label">
              Set {selectedIndex >= 0 ? selectedIndex + 1 : 1} of {exercise.sets.length}
            </span>
            <div className="set-dots">
              {exercise.sets.map((set, index) => {
                const state = set.task.status === 'done'
                  ? ' is-done'
                  : set.task.status === 'canceled'
                    ? ' is-skipped'
                    : ''
                return (
                  <button
                    key={set.task.id}
                    type="button"
                    className={`set-dot${set.task.id === selectedSetId ? ' is-active' : ''}${state}`}
                    aria-label={`Set ${index + 1}`}
                    aria-current={set.task.id === selectedSetId}
                    onClick={() => onSelectSet(set.task.id)}
                  >
                    {index + 1}
                  </button>
                )
              })}
            </div>
          </div>

          {selectedSet && (
            <SetPanel
              key={selectedSet.task.id}
              set={selectedSet}
              detailsOpen={detailsOpen}
              onToggleDetails={onToggleDetails}
              onRegisterFlush={onRegisterFlush}
            />
          )}
        </>
      )}

      <button
        type="button"
        className="text-button add-set-button"
        disabled={busy}
        onClick={addAndSelect}
      >
        <Plus size={14} aria-hidden="true" /> Add set
      </button>

      {exercise.notes.map((note) => (
        <p key={note.id} className="exercise-note">{note.plainText}</p>
      ))}
    </section>
  )
}
