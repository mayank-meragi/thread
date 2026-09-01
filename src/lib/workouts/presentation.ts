import type { PropertyValue, TaskRecord } from '../../db'
import type { WorkoutExerciseView, WorkoutSetView, WorkoutView } from './types'

export type WorkoutLensState = 'planned' | 'active' | 'completed' | 'canceled'

export interface SetTally {
  /** Sets marked done. */
  completed: number
  /** Sets still needing action (neither done nor skipped). */
  actionable: number
  /** Sets skipped/canceled. */
  skipped: number
  total: number
}

export function workoutLensState(view: Pick<WorkoutView, 'task'>): WorkoutLensState {
  switch (view.task.status) {
    case 'done':
      return 'completed'
    case 'canceled':
      return 'canceled'
    case 'in_progress':
      return 'active'
    default:
      return 'planned'
  }
}

export function tallySets(sets: readonly Pick<WorkoutSetView, 'task'>[]): SetTally {
  let completed = 0
  let skipped = 0
  for (const set of sets) {
    if (set.task.status === 'done') completed += 1
    else if (set.task.status === 'canceled') skipped += 1
  }
  return { completed, skipped, actionable: sets.length - completed - skipped, total: sets.length }
}

export function tallyWorkoutSets(view: Pick<WorkoutView, 'exercises'>): SetTally {
  return tallySets(view.exercises.flatMap((exercise) => exercise.sets))
}

/** Milliseconds between the recorded start and finish (or now, while active). `undefined` until a workout is started. */
export function elapsedMs(
  view: Pick<WorkoutView, 'properties'>,
  now: number = Date.now(),
): number | undefined {
  const startedAt = view.properties.get('workout-started-at')
  if (typeof startedAt !== 'string') return undefined
  const start = Date.parse(startedAt)
  if (Number.isNaN(start)) return undefined
  const finishedAt = view.properties.get('workout-finished-at')
  const end = typeof finishedAt === 'string' ? Date.parse(finishedAt) : now
  if (Number.isNaN(end)) return undefined
  return Math.max(0, end - start)
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

/** The next set the athlete should act on: first not-yet-done, not-skipped set in document order. */
export function nextActionableSetId(view: Pick<WorkoutView, 'exercises'>): string | undefined {
  for (const exercise of view.exercises) {
    for (const set of exercise.sets) {
      if (set.task.status !== 'done' && set.task.status !== 'canceled') return set.task.id
    }
  }
  return undefined
}

export function exerciseSummary(exercise: Pick<WorkoutExerciseView, 'task' | 'sets'>): {
  tally: SetTally
  complete: boolean
} {
  const tally = tallySets(exercise.sets)
  const complete = exercise.task.status === 'done'
    || (tally.total > 0 && tally.actionable === 0)
  return { tally, complete }
}

export function sourceHref(task: Pick<TaskRecord, 'day' | 'id'>): string {
  return `#/?date=${task.day}&block=${task.id}`
}

/** Human label for a workout/exercise/set task: drops the leading structural hashtag and unwraps wiki-links. */
export function stripStructuralTag(text: string, role: 'workout' | 'exercise' | 'set'): string {
  return text
    .replace(new RegExp(`^#\\[?${role}\\]?\\s*`), '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .trim()
}

/** One-line human summary of the measurements a set actually carries, e.g. `60 kg × 8 · RPE 7`. */
export function describeSet(properties: Map<string, PropertyValue>): string {
  const num = (id: string): number | undefined => {
    const value = properties.get(id)
    return typeof value === 'number' ? value : undefined
  }
  const text = (id: string): string | undefined => {
    const value = properties.get(id)
    return typeof value === 'string' && value ? value : undefined
  }
  const parts: string[] = []

  const load = num('set-load')
  const reps = num('set-reps')
  if (load !== undefined) parts.push(`${load}${text('set-load-unit') ? ` ${text('set-load-unit')}` : ''}${reps !== undefined ? ` × ${reps}` : ''}`)
  else if (reps !== undefined) parts.push(`${reps} reps`)

  const distance = num('set-distance')
  if (distance !== undefined) parts.push(`${distance}${text('set-distance-unit') ? ` ${text('set-distance-unit')}` : ''}`)

  const duration = num('set-duration-seconds')
  if (duration !== undefined) parts.push(formatDuration(duration * 1000))

  const rpe = num('set-rpe')
  if (rpe !== undefined) parts.push(`RPE ${rpe}`)

  return parts.join(' · ')
}
