import { useMemo, useState } from 'react'
import { Dumbbell, Plus } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router-dom'
import { createWorkout } from '../lib/workouts/mutations'
import { getAllWorkouts } from '../lib/workouts/selectors'
import { stripStructuralTag, tallyWorkoutSets, workoutLensState } from '../lib/workouts/presentation'
import type { WorkoutView } from '../lib/workouts/types'
import { formatDay, isoToday } from '../lib/dates'

const STATE_LABEL = { planned: 'Planned', active: 'Active', completed: 'Completed', canceled: 'Canceled' } as const

function workoutLabel(workout: WorkoutView): string {
  return workout.thread?.title || stripStructuralTag(workout.task.text, 'workout') || 'Workout'
}

function WorkoutRow({ workout }: { workout: WorkoutView }) {
  const state = workoutLensState(workout)
  const tally = tallyWorkoutSets(workout)
  const href = `/workout/${workout.task.day}/${workout.task.id}/overview`
  return (
    <div className="today-workout-row">
      <span className={`today-workout-state state-${state}`}>{STATE_LABEL[state]}</span>
      <Link className="today-workout-name" to={href}>{workoutLabel(workout)}</Link>
      <span className="today-workout-meta">{formatDay(workout.task.day).short} · {tally.completed}/{tally.total} sets</span>
      <Link className="today-workout-open" to={href}>{state === 'active' ? 'Resume' : 'Open'}</Link>
    </div>
  )
}

export function WorkoutsPage() {
  const workouts = useLiveQuery(() => getAllWorkouts(), [], [])
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const newWorkout = async () => {
    setBusy(true)
    try {
      const today = isoToday()
      const id = await createWorkout({ day: today })
      navigate(`/workout/${today}/${id}/overview`)
    } finally {
      setBusy(false)
    }
  }

  const groups = useMemo(() => {
    const today = isoToday()
    const active: WorkoutView[] = []
    const upcoming: WorkoutView[] = []
    const past: WorkoutView[] = []
    for (const workout of workouts) {
      const state = workoutLensState(workout)
      if (state === 'active') active.push(workout)
      else if (state === 'planned' && workout.task.day >= today) upcoming.push(workout)
      else past.push(workout)
    }
    upcoming.sort((a, b) => a.task.day.localeCompare(b.task.day))
    past.sort((a, b) => b.task.day.localeCompare(a.task.day))
    return { active, upcoming, past }
  }, [workouts])

  const sections: Array<{ key: string; label: string; items: WorkoutView[] }> = [
    { key: 'active', label: 'Active', items: groups.active },
    { key: 'upcoming', label: 'Upcoming', items: groups.upcoming },
    { key: 'past', label: 'Past', items: groups.past },
  ]

  return (
    <article className="workouts-page">
      <header className="workouts-hero">
        <div>
          <div className="eyebrow">Training</div>
          <h1>Workouts</h1>
        </div>
        <span className="workouts-hero-count">{workouts.length} logged</span>
      </header>

      <button type="button" className="today-workout-new" disabled={busy} onClick={() => void newWorkout()}>
        <Plus size={14} aria-hidden="true" /> New workout
      </button>

      {workouts.length === 0 ? (
        <div className="workouts-empty">
          <Dumbbell size={20} aria-hidden="true" />
          <p>No workouts yet. Start one to build your training log.</p>
        </div>
      ) : (
        sections.filter((section) => section.items.length > 0).map((section) => (
          <section className="workout-group" key={section.key}>
            <header>
              <h2>{section.label}</h2>
              <span>{section.items.length}</span>
            </header>
            {section.items.map((workout) => <WorkoutRow key={workout.task.id} workout={workout} />)}
          </section>
        ))
      )}
    </article>
  )
}
