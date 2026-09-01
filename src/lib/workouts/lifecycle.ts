import { db, removeBlockProperty, setBlockProperty } from '../../db'
import { setTaskStatus } from '../tasks'
import { assertValidSetMeasurements } from './mutations'
import { getActiveWorkout, getWorkout, getWorkoutForBlock, getWorkoutRole } from './selectors'
import type { WorkoutSetView, WorkoutView } from './types'

export interface ActiveWorkoutConflict {
  code: 'workout_already_active'
  activeWorkoutTaskId: string
}

/** Thrown by {@link startWorkout} when a different workout is already in progress. */
export class ActiveWorkoutConflictError extends Error {
  constructor(readonly conflict: ActiveWorkoutConflict) {
    super('Another workout is already in progress.')
    this.name = 'ActiveWorkoutConflictError'
  }
}

/** Thrown by {@link finishWorkout} when sets are unresolved and the caller has not chosen how to handle them. */
export class UnresolvedSetsError extends Error {
  constructor(readonly setTaskIds: string[]) {
    super('This workout still has unresolved sets.')
    this.name = 'UnresolvedSetsError'
  }
}

function allSets(workout: WorkoutView): WorkoutSetView[] {
  return workout.exercises.flatMap((exercise) => exercise.sets)
}

function isUnresolved(set: WorkoutSetView): boolean {
  return set.task.status !== 'done' && set.task.status !== 'canceled'
}

function isPending(status: string): boolean {
  return status === 'not_started' || status === 'in_progress'
}

async function requireWorkout(workoutTaskId: string): Promise<void> {
  const task = await db.tasks.get(workoutTaskId)
  if (!task) throw new Error('This workout no longer exists.')
  if ((await getWorkoutRole(workoutTaskId)) !== 'workout') throw new Error('This task is not a workout.')
}

export async function startWorkout(workoutTaskId: string): Promise<void> {
  await requireWorkout(workoutTaskId)

  const active = await getActiveWorkout()
  if (active && active.task.id !== workoutTaskId) {
    throw new ActiveWorkoutConflictError({ code: 'workout_already_active', activeWorkoutTaskId: active.task.id })
  }

  const task = await db.tasks.get(workoutTaskId)
  if (task && task.status !== 'in_progress') await setTaskStatus(workoutTaskId, 'in_progress')

  const started = await db.blockProperties
    .where('[blockId+propertyId]')
    .equals([workoutTaskId, 'workout-started-at'])
    .first()
  if (!started) await setBlockProperty(workoutTaskId, 'workout-started-at', new Date().toISOString())
}

/**
 * Marks a set done through the shared task-status path and returns the id of the
 * next pending set (in document order) for the UI to focus, or `undefined` when
 * none remain after it.
 */
export async function completeSet(setTaskId: string): Promise<string | undefined> {
  const workout = await getWorkoutForBlock(setTaskId)
  if (!workout) throw new Error('This set is not part of a workout.')
  const sets = allSets(workout)
  const target = sets.find((set) => set.task.id === setTaskId)
  if (!target) throw new Error('This set is not part of a workout.')

  assertValidSetMeasurements(target.properties)
  if (target.task.status !== 'done') await setTaskStatus(setTaskId, 'done')

  const reloaded = await getWorkout(workout.task.id)
  if (!reloaded) return undefined
  const reloadedSets = allSets(reloaded)
  const fromIndex = reloadedSets.findIndex((set) => set.task.id === setTaskId)
  return reloadedSets.slice(fromIndex + 1).find((set) => isPending(set.task.status))?.task.id
}

export interface FinishWorkoutOptions {
  /** How to treat sets that are neither done nor skipped. Required when any exist. */
  unresolvedSets?: 'cancel' | 'leave'
}

export async function finishWorkout(workoutTaskId: string, options: FinishWorkoutOptions = {}): Promise<void> {
  await requireWorkout(workoutTaskId)
  const workout = await getWorkout(workoutTaskId)
  if (!workout) throw new Error('This workout no longer exists.')

  const unresolved = allSets(workout).filter(isUnresolved)
  if (unresolved.length > 0 && !options.unresolvedSets) {
    throw new UnresolvedSetsError(unresolved.map((set) => set.task.id))
  }
  if (options.unresolvedSets === 'cancel') {
    for (const set of unresolved) await setTaskStatus(set.task.id, 'canceled')
  }

  await setTaskStatus(workoutTaskId, 'done')

  const finished = await db.blockProperties
    .where('[blockId+propertyId]')
    .equals([workoutTaskId, 'workout-finished-at'])
    .first()
  if (!finished) await setBlockProperty(workoutTaskId, 'workout-finished-at', new Date().toISOString())
}

export async function cancelWorkout(
  workoutTaskId: string,
  options: { cancelDescendants?: boolean } = {},
): Promise<void> {
  await requireWorkout(workoutTaskId)

  if (options.cancelDescendants) {
    const workout = await getWorkout(workoutTaskId)
    for (const exercise of workout?.exercises ?? []) {
      for (const set of exercise.sets) {
        if (isUnresolved(set)) await setTaskStatus(set.task.id, 'canceled')
      }
      if (exercise.task.status !== 'done' && exercise.task.status !== 'canceled') {
        await setTaskStatus(exercise.task.id, 'canceled')
      }
    }
  }

  await setTaskStatus(workoutTaskId, 'canceled')
}

export async function reopenWorkout(workoutTaskId: string): Promise<void> {
  await requireWorkout(workoutTaskId)
  await removeBlockProperty(workoutTaskId, 'workout-finished-at')
  await setTaskStatus(workoutTaskId, 'in_progress')
}
