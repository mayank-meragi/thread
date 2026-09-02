import { Check, ChevronDown } from 'lucide-react'
import { exerciseSummary, stripStructuralTag } from '../../lib/workouts/presentation'
import type { WorkoutExerciseView } from '../../lib/workouts/types'

function exerciseName(exercise: WorkoutExerciseView): string {
  return exercise.exerciseThread?.title
    || stripStructuralTag(exercise.task.text, 'exercise')
    || 'Exercise'
}

export function CollapsedExercise({
  exercise,
  onExpand,
}: {
  exercise: WorkoutExerciseView
  onExpand: (id: string) => void
}) {
  const { tally, complete } = exerciseSummary(exercise)

  return (
    <button
      type="button"
      className={`collapsed-exercise${complete ? ' is-complete' : ''}`}
      aria-expanded={false}
      onClick={() => onExpand(exercise.task.id)}
    >
      <span className="collapsed-exercise-name">
        {complete && <Check size={14} aria-hidden="true" />}
        {exerciseName(exercise)}
      </span>
      <span className="collapsed-exercise-meta">
        <span className="collapsed-exercise-count">{tally.completed}/{tally.total} sets</span>
        <ChevronDown size={18} aria-hidden="true" />
      </span>
    </button>
  )
}
