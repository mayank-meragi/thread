import { useLiveQuery } from 'dexie-react-hooks'
import { Dumbbell, ExternalLink, GitBranch, Plus } from 'lucide-react'
import { removeBlockProperty, setBlockProperty, type PropertyValue, type TaskRecord } from '../../db'
import { addSet } from '../../lib/workouts/mutations'
import { getWorkoutForBlock } from '../../lib/workouts/selectors'
import { elapsedMs, formatDuration, tallySets } from '../../lib/workouts/presentation'
import type { WorkoutRole } from '../../lib/workouts/systemTags'
import type { WorkoutView } from '../../lib/workouts/types'
import { SetEditor } from '../workouts/SetEditor'

function toLocalInput(value: PropertyValue | undefined): string {
  if (typeof value !== 'string') return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromLocalInput(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

interface SectionProps {
  task: TaskRecord
  values: Map<string, PropertyValue>
  role: WorkoutRole
  run: (operation: () => Promise<unknown>) => Promise<void>
  onNavigate: () => void
}

export function WorkoutInspectorSections({ task, values, role, run, onNavigate }: SectionProps) {
  const workout = useLiveQuery(() => getWorkoutForBlock(task.id), [task.id])

  if (role === 'workout') return <WorkoutSection task={task} values={values} workout={workout} run={run} onNavigate={onNavigate} />
  if (role === 'exercise') return <ExerciseSection task={task} workout={workout} run={run} onNavigate={onNavigate} />
  return <SetSection task={task} values={values} workout={workout} onNavigate={onNavigate} />
}

function OpenWorkoutLink({ workout, onNavigate }: { workout: WorkoutView | undefined; onNavigate: () => void }) {
  if (!workout) return null
  return (
    <a className="inspector-workout-link" href={`#/workout/${workout.task.day}/${workout.task.id}`} onClick={onNavigate}>
      <ExternalLink size={13} aria-hidden="true" /> Open workout
    </a>
  )
}

function WorkoutSection({
  task, values, workout, run, onNavigate,
}: {
  task: TaskRecord
  values: Map<string, PropertyValue>
  workout: WorkoutView | undefined
  run: SectionProps['run']
  onNavigate: () => void
}) {
  const tally = workout ? tallySets(workout.exercises.flatMap((exercise) => exercise.sets)) : undefined
  const elapsed = workout ? elapsedMs(workout) : undefined

  const setTime = (propertyId: 'workout-started-at' | 'workout-finished-at', raw: string) =>
    void run(() => {
      const iso = fromLocalInput(raw)
      return iso ? setBlockProperty(task.id, propertyId, iso) : removeBlockProperty(task.id, propertyId)
    })

  return (
    <section className="inspector-section">
      <div className="inspector-section-title"><span><Dumbbell size={14} aria-hidden="true" /> Workout</span></div>
      <a className="inspector-workout-link" href={`#/workout/${task.day}/${task.id}`} onClick={onNavigate}>
        <ExternalLink size={13} aria-hidden="true" /> Open workout
      </a>
      <div className="task-detail-grid">
        <label>
          <span>Started</span>
          <input type="datetime-local" value={toLocalInput(values.get('workout-started-at'))} onChange={(event) => setTime('workout-started-at', event.target.value)} />
        </label>
        <label>
          <span>Finished</span>
          <input type="datetime-local" value={toLocalInput(values.get('workout-finished-at'))} onChange={(event) => setTime('workout-finished-at', event.target.value)} />
        </label>
      </div>
      {tally && (
        <p className="field-hint">
          {workout!.exercises.length} exercise{workout!.exercises.length === 1 ? '' : 's'} · {tally.completed}/{tally.total} sets
          {elapsed !== undefined ? ` · ${formatDuration(elapsed)}` : ''}
        </p>
      )}
    </section>
  )
}

function ExerciseSection({
  task, workout, run, onNavigate,
}: {
  task: TaskRecord
  workout: WorkoutView | undefined
  run: SectionProps['run']
  onNavigate: () => void
}) {
  const view = workout?.exercises.find((exercise) => exercise.task.id === task.id)
  const tally = view ? tallySets(view.sets) : undefined

  return (
    <section className="inspector-section">
      <div className="inspector-section-title"><span><Dumbbell size={14} aria-hidden="true" /> Exercise</span></div>
      {view?.exerciseThread && (
        <a className="inspector-workout-link" href={`#/thread/${view.exerciseThread.id}`} onClick={onNavigate}>
          <GitBranch size={13} aria-hidden="true" /> {view.exerciseThread.title}
        </a>
      )}
      {tally && (
        <p className="field-hint">
          {tally.completed}/{tally.total} sets{tally.skipped > 0 ? ` · ${tally.skipped} skipped` : ''}
        </p>
      )}
      <div className="inspector-workout-actions">
        <button type="button" onClick={() => void run(() => addSet(task.id))}><Plus size={13} aria-hidden="true" /> Add set</button>
      </div>
      <OpenWorkoutLink workout={workout} onNavigate={onNavigate} />
    </section>
  )
}

function SetSection({
  task, values, workout, onNavigate,
}: {
  task: TaskRecord
  values: Map<string, PropertyValue>
  workout: WorkoutView | undefined
  onNavigate: () => void
}) {
  return (
    <section className="inspector-section">
      <div className="inspector-section-title"><span><Dumbbell size={14} aria-hidden="true" /> Set measurements</span></div>
      <SetEditor key={task.id} setTaskId={task.id} properties={values} />
      <OpenWorkoutLink workout={workout} onNavigate={onNavigate} />
    </section>
  )
}
