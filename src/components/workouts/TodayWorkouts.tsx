import { useState } from 'react'
import { Dumbbell, Plus } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router-dom'
import { createWorkout } from '../../lib/workouts/mutations'
import { getWorkoutsForDay } from '../../lib/workouts/selectors'
import { stripStructuralTag, tallyWorkoutSets, workoutLensState } from '../../lib/workouts/presentation'

const STATE_LABEL = { planned: 'Planned', active: 'Active', completed: 'Completed', canceled: 'Canceled' } as const

export function TodayWorkouts({ today }: { today: string }) {
  const workouts = useLiveQuery(() => getWorkoutsForDay(today), [today], [])
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const newWorkout = async () => {
    setBusy(true)
    try {
      const id = await createWorkout({ day: today })
      navigate(`/workout/${today}/${id}`)
    } finally {
      setBusy(false)
    }
  }

  if (workouts.length === 0) {
    return (
      <section className="today-workouts" aria-labelledby="today-workouts-heading">
        <header className="today-workouts-heading">
          <div>
            <div className="eyebrow">Training</div>
            <h2 id="today-workouts-heading">Workouts</h2>
          </div>
          <Dumbbell size={18} />
        </header>
        <button type="button" className="today-workout-new" disabled={busy} onClick={() => void newWorkout()}>
          <Plus size={14} aria-hidden="true" /> New workout
        </button>
      </section>
    )
  }

  return (
    <section className="today-workouts" aria-labelledby="today-workouts-heading">
      <header className="today-workouts-heading">
        <div>
          <div className="eyebrow">Training</div>
          <h2 id="today-workouts-heading">Workouts</h2>
        </div>
        <Dumbbell size={18} />
      </header>

      {workouts.map((workout) => {
        const state = workoutLensState(workout)
        const tally = tallyWorkoutSets(workout)
        const label = workout.thread?.title || stripStructuralTag(workout.task.text, 'workout') || 'Workout'
        return (
          <div className="today-workout-row" key={workout.task.id}>
            <span className={`today-workout-state state-${state}`}>{STATE_LABEL[state]}</span>
            <Link className="today-workout-name" to={`/workout/${workout.task.day}/${workout.task.id}`}>{label}</Link>
            <span className="today-workout-meta">{tally.completed}/{tally.total} sets</span>
            <Link className="today-workout-open" to={`/workout/${workout.task.day}/${workout.task.id}`}>
              {state === 'active' ? 'Resume' : 'Open'}
            </Link>
          </div>
        )
      })}

      <button type="button" className="today-workout-new" disabled={busy} onClick={() => void newWorkout()}>
        <Plus size={14} aria-hidden="true" /> New workout
      </button>
    </section>
  )
}
