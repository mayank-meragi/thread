import { db, removeBlockProperty, setBlockProperty, type PropertyValue } from '../../db'
import {
  createWorkoutSubtask,
  createWorkoutTask,
  deleteTask,
  duplicateTask,
  setTaskStatus,
} from '../tasks'
import { getWorkoutRole } from './selectors'
import { systemTagIdForWorkoutRole } from './systemTags'

// Friendly, typed shape for the seven optional set measurements. Each key maps
// to a built-in block property supplied by the `#[set]` tag schema. A key that
// is present with `null` (or `''`) clears that property; an absent key is left
// untouched, so partial edits and retries stay safe.
export interface SetPropertyInput {
  load?: number | null
  loadUnit?: string | null
  reps?: number | null
  rpe?: number | null
  durationSeconds?: number | null
  distance?: number | null
  distanceUnit?: string | null
}

const SET_PROPERTY_BY_KEY: Record<keyof SetPropertyInput, string> = {
  load: 'set-load',
  loadUnit: 'set-load-unit',
  reps: 'set-reps',
  rpe: 'set-rpe',
  durationSeconds: 'set-duration-seconds',
  distance: 'set-distance',
  distanceUnit: 'set-distance-unit',
}

function wikiLink(title: string): string {
  const trimmed = title.trim()
  return /^\[\[.*\]\]$/.test(trimmed) ? trimmed : `[[${trimmed}]]`
}

async function requireRole(taskId: string, role: 'workout' | 'exercise' | 'set'): Promise<void> {
  const actual = await getWorkoutRole(taskId)
  if (actual !== role) {
    throw new Error(role === 'workout' ? 'This task is not a workout.' : `This task is not a workout ${role}.`)
  }
}

/**
 * Shared measurement validation for the set editor and the complete-set
 * lifecycle step. Operates on the effective property map (existing values with
 * the pending patch already applied) so "load requires a unit" style rules hold
 * regardless of which fields a single edit touched.
 */
export function assertValidSetMeasurements(values: Map<string, PropertyValue>): void {
  const asNumber = (id: string): number | undefined => {
    const value = values.get(id)
    return typeof value === 'number' ? value : undefined
  }
  const load = asNumber('set-load')
  const reps = asNumber('set-reps')
  const rpe = asNumber('set-rpe')
  const duration = asNumber('set-duration-seconds')
  const distance = asNumber('set-distance')

  for (const measurement of [load, reps, rpe, duration, distance]) {
    if (typeof measurement === 'number' && measurement < 0) throw new Error('Measurements cannot be negative.')
  }
  if (typeof reps === 'number' && !Number.isInteger(reps)) throw new Error('Reps must be a whole number.')
  if (typeof rpe === 'number' && (rpe < 1 || rpe > 10)) throw new Error('RPE must be between 1 and 10.')
  if (typeof load === 'number' && typeof values.get('set-load-unit') !== 'string') throw new Error('Load needs a load unit.')
  if (typeof distance === 'number' && typeof values.get('set-distance-unit') !== 'string') throw new Error('Distance needs a distance unit.')
}

export async function createWorkout(input: { day?: string; title?: string } = {}): Promise<string> {
  const title = input.title?.trim()
  return createWorkoutTask({ role: 'workout', text: title ? wikiLink(title) : 'Workout', day: input.day })
}

export async function addExercise(workoutTaskId: string, exerciseTitle: string): Promise<string> {
  await requireRole(workoutTaskId, 'workout')
  const title = exerciseTitle.trim()
  if (!title) throw new Error('An exercise needs a name.')
  return createWorkoutSubtask(workoutTaskId, 'exercise', wikiLink(title))
}

export async function addSet(exerciseTaskId: string): Promise<string> {
  await requireRole(exerciseTaskId, 'exercise')
  const exercise = await db.tasks.get(exerciseTaskId)
  if (!exercise) throw new Error('This exercise no longer exists.')
  const setTagId = systemTagIdForWorkoutRole('set')
  const childIds = new Set(
    (await db.tasks.where('day').equals(exercise.day).toArray())
      .filter((task) => task.parentTaskId === exerciseTaskId)
      .map((task) => task.id),
  )
  const existingSets = (await db.blockTags.where('tagId').equals(setTagId).toArray())
    .filter((row) => childIds.has(row.blockId)).length
  return createWorkoutSubtask(exerciseTaskId, 'set', `Set ${existingSets + 1}`)
}

export async function updateSet(setTaskId: string, values: SetPropertyInput): Promise<void> {
  const task = await db.tasks.get(setTaskId)
  if (!task) throw new Error('This set no longer exists.')
  await requireRole(setTaskId, 'set')

  const effective = new Map<string, PropertyValue>(
    (await db.blockProperties.where('blockId').equals(setTaskId).toArray()).map((row) => [row.propertyId, row.value]),
  )
  const patch: Array<{ propertyId: string; value: PropertyValue | null }> = []
  for (const key of Object.keys(SET_PROPERTY_BY_KEY) as Array<keyof SetPropertyInput>) {
    if (!(key in values)) continue
    const propertyId = SET_PROPERTY_BY_KEY[key]
    const raw = values[key]
    const value: PropertyValue | null = raw === '' || raw === undefined ? null : raw
    patch.push({ propertyId, value })
    if (value === null) effective.delete(propertyId)
    else effective.set(propertyId, value)
  }

  assertValidSetMeasurements(effective)

  for (const { propertyId, value } of patch) {
    if (value === null) await removeBlockProperty(setTaskId, propertyId)
    else await setBlockProperty(setTaskId, propertyId, value)
  }
}

export async function duplicateSet(setTaskId: string): Promise<string> {
  await requireRole(setTaskId, 'set')
  // duplicateTask already copies block properties and descriptive tags.
  return duplicateTask(setTaskId)
}

export async function skipSet(setTaskId: string): Promise<void> {
  await requireRole(setTaskId, 'set')
  await setTaskStatus(setTaskId, 'canceled')
}

export async function skipExercise(exerciseTaskId: string): Promise<void> {
  await requireRole(exerciseTaskId, 'exercise')
  await setTaskStatus(exerciseTaskId, 'canceled')
}

export async function deleteWorkoutItem(taskId: string): Promise<void> {
  if (!(await getWorkoutRole(taskId))) throw new Error('This task is not part of a workout.')
  await deleteTask(taskId)
}
