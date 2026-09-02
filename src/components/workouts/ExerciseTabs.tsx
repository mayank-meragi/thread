import { Check } from 'lucide-react'
import { exerciseSummary, stripStructuralTag } from '../../lib/workouts/presentation'
import type { WorkoutExerciseView } from '../../lib/workouts/types'

function exerciseName(exercise: WorkoutExerciseView): string {
  return exercise.exerciseThread?.title
    || stripStructuralTag(exercise.task.text, 'exercise')
    || 'Exercise'
}

export function ExerciseTabs({
  exercises,
  selectedId,
  onSelect,
}: {
  exercises: WorkoutExerciseView[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="exercise-tabs" role="tablist" aria-label="Exercises">
      {exercises.map((exercise) => {
        const { tally, complete } = exerciseSummary(exercise)
        const active = exercise.task.id === selectedId
        return (
          <button
            key={exercise.task.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`exercise-tab${active ? ' is-active' : ''}${complete ? ' is-complete' : ''}`}
            onClick={() => onSelect(exercise.task.id)}
          >
            <span className="exercise-tab-name">
              {complete && <Check size={13} aria-hidden="true" />}
              {exerciseName(exercise)}
            </span>
            <span className="exercise-tab-count">{tally.completed}/{tally.total}</span>
          </button>
        )
      })}
    </div>
  )
}
