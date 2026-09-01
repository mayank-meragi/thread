import { db, type BlockPropertyRecord, type BlockTagRecord, type PropertyValue, type TaskRecord, type ThreadOccurrenceRecord } from '../../db'
import type { OutlineBlock } from '../outline'
import { workoutRoleFromTagIds, type WorkoutRole } from './systemTags'
import type { WorkoutDiagnostic, WorkoutExerciseView, WorkoutSetView, WorkoutView } from './types'

interface DayWorkoutSnapshot {
  tasks: TaskRecord[]
  blocks: OutlineBlock[]
  tags: BlockTagRecord[]
  properties: BlockPropertyRecord[]
  occurrences: ThreadOccurrenceRecord[]
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const id = key(row)
    grouped.set(id, [...(grouped.get(id) ?? []), row])
  }
  return grouped
}

async function loadDaySnapshot(day: string): Promise<DayWorkoutSnapshot> {
  const [tasks, blocks, tags, properties, occurrences] = await Promise.all([
    db.tasks.where('day').equals(day).sortBy('order'),
    db.blocks.where('day').equals(day).sortBy('order'),
    db.blockTags.where('day').equals(day).toArray(),
    db.blockProperties.where('day').equals(day).toArray(),
    db.occurrences.where('day').equals(day).toArray(),
  ])
  return { tasks, blocks, tags, properties, occurrences }
}

function propertyMap(rows: BlockPropertyRecord[]): Map<string, PropertyValue> {
  return new Map(rows.map((row) => [row.propertyId, row.value]))
}

function validateSetProperties(blockId: string, values: Map<string, PropertyValue>): WorkoutDiagnostic | undefined {
  const load = values.get('set-load')
  const reps = values.get('set-reps')
  const rpe = values.get('set-rpe')
  const duration = values.get('set-duration-seconds')
  const distance = values.get('set-distance')
  const invalid = (typeof load === 'number' && load < 0)
    || (typeof reps === 'number' && (reps < 0 || !Number.isInteger(reps)))
    || (typeof rpe === 'number' && (rpe < 1 || rpe > 10))
    || (typeof duration === 'number' && duration < 0)
    || (typeof distance === 'number' && distance < 0)
    || (typeof load === 'number' && typeof values.get('set-load-unit') !== 'string')
    || (typeof distance === 'number' && typeof values.get('set-distance-unit') !== 'string')
  return invalid ? { code: 'invalid_set_properties', blockId, message: 'This set has invalid or incomplete measurements.' } : undefined
}

function buildWorkout(snapshot: DayWorkoutSnapshot, workoutTaskId: string): WorkoutView | undefined {
  const taskById = new Map(snapshot.tasks.map((task) => [task.id, task]))
  const tagsByBlock = groupBy(snapshot.tags, (row) => row.blockId)
  const propertiesByBlock = groupBy(snapshot.properties, (row) => row.blockId)
  const occurrencesByBlock = groupBy(snapshot.occurrences, (row) => row.rootBlockId)
  const roleOf = (taskId: string): WorkoutRole | undefined => workoutRoleFromTagIds((tagsByBlock.get(taskId) ?? []).map((row) => row.tagId))
  const workout = taskById.get(workoutTaskId)
  if (!workout || roleOf(workout.id) !== 'workout') return undefined

  const nearestRoleAncestor = (task: TaskRecord, role: WorkoutRole): TaskRecord | undefined => {
    let parentId = task.parentTaskId
    while (parentId) {
      const parent = taskById.get(parentId)
      if (!parent) return undefined
      if (roleOf(parent.id) === role) return parent
      parentId = parent.parentTaskId
    }
    return undefined
  }

  const diagnostics: WorkoutDiagnostic[] = []
  const exerciseTasks = snapshot.tasks.filter((task) => roleOf(task.id) === 'exercise' && nearestRoleAncestor(task, 'workout')?.id === workout.id)
  const exercises: WorkoutExerciseView[] = exerciseTasks.map((exercise) => {
    const occurrence = occurrencesByBlock.get(exercise.id)?.[0]
    if (!occurrence) diagnostics.push({ code: 'missing_exercise_link', blockId: exercise.id, message: 'Exercise tasks should link to an exercise thread.' })
    const setTasks = snapshot.tasks.filter((task) => roleOf(task.id) === 'set' && nearestRoleAncestor(task, 'exercise')?.id === exercise.id)
    const sets: WorkoutSetView[] = setTasks.map((set) => {
      const propertyRows = propertiesByBlock.get(set.id) ?? []
      const properties = propertyMap(propertyRows)
      const diagnostic = validateSetProperties(set.id, properties)
      if (diagnostic) diagnostics.push(diagnostic)
      return { task: set, properties, propertyRows, tags: tagsByBlock.get(set.id) ?? [] }
    })
    return {
      task: exercise,
      exerciseThread: occurrence ? { id: occurrence.threadId, title: occurrence.title } : undefined,
      sets,
      notes: snapshot.blocks.filter((block) => block.parentId === exercise.id && block.kind !== 'task'),
    }
  })

  for (const task of snapshot.tasks) {
    const role = roleOf(task.id)
    if (role === 'exercise' && !nearestRoleAncestor(task, 'workout')) diagnostics.push({ code: 'invalid_parent', blockId: task.id, message: 'This exercise is not inside a workout.' })
    if (role === 'set' && !nearestRoleAncestor(task, 'exercise')) diagnostics.push({ code: 'invalid_parent', blockId: task.id, message: 'This set is not inside an exercise.' })
  }

  const workoutOccurrence = occurrencesByBlock.get(workout.id)?.[0]
  return {
    task: workout,
    thread: workoutOccurrence ? { id: workoutOccurrence.threadId, title: workoutOccurrence.title } : undefined,
    properties: propertyMap(propertiesByBlock.get(workout.id) ?? []),
    exercises,
    notes: snapshot.blocks.filter((block) => block.parentId === workout.id && block.kind !== 'task'),
    diagnostics,
  }
}

export async function getWorkoutRole(blockId: string): Promise<WorkoutRole | undefined> {
  const tags = await db.blockTags.where('blockId').equals(blockId).toArray()
  return workoutRoleFromTagIds(tags.map((tag) => tag.tagId))
}

export async function getWorkout(workoutTaskId: string): Promise<WorkoutView | undefined> {
  const task = await db.tasks.get(workoutTaskId)
  return task ? buildWorkout(await loadDaySnapshot(task.day), workoutTaskId) : undefined
}

export async function getWorkoutForBlock(blockId: string): Promise<WorkoutView | undefined> {
  const block = await db.blocks.get(blockId)
  if (!block) return undefined
  const snapshot = await loadDaySnapshot(block.day)
  const taskById = new Map(snapshot.tasks.map((task) => [task.id, task]))
  const blockById = new Map(snapshot.blocks.map((item) => [item.id, item]))
  const tagsByBlock = groupBy(snapshot.tags, (row) => row.blockId)
  let currentId: string | null | undefined = taskById.has(blockId) ? blockId : block.parentId
  while (currentId) {
    if (workoutRoleFromTagIds((tagsByBlock.get(currentId) ?? []).map((tag) => tag.tagId)) === 'workout') return buildWorkout(snapshot, currentId)
    currentId = taskById.get(currentId)?.parentTaskId ?? blockById.get(currentId)?.parentId
  }
  return undefined
}

export async function getWorkoutsForDay(day: string): Promise<WorkoutView[]> {
  const snapshot = await loadDaySnapshot(day)
  const tagsByBlock = groupBy(snapshot.tags, (row) => row.blockId)
  return snapshot.tasks
    .filter((task) => workoutRoleFromTagIds((tagsByBlock.get(task.id) ?? []).map((tag) => tag.tagId)) === 'workout')
    .map((task) => buildWorkout(snapshot, task.id))
    .filter((workout): workout is WorkoutView => Boolean(workout))
}

export async function getActiveWorkout(day?: string): Promise<WorkoutView | undefined> {
  const tasks = day ? await db.tasks.where('day').equals(day).sortBy('order') : await db.tasks.where('status').equals('in_progress').toArray()
  for (const task of tasks) {
    if (task.status === 'in_progress' && await getWorkoutRole(task.id) === 'workout') return getWorkout(task.id)
  }
  return undefined
}

export interface ExerciseOccurrence {
  day: string
  exerciseTaskId: string
  workoutTaskId?: string
  status: TaskRecord['status']
  totalSets: number
  completedSets: number
  skippedSets: number
}

/**
 * Every day this thread appears as an `#[exercise]` task, with its set counts
 * and completion. Powers the "Workout occurrences" section on an exercise's
 * ThreadPage. Grouped and sorted newest day first.
 */
export async function getExerciseOccurrences(threadId: string): Promise<ExerciseOccurrence[]> {
  const occurrences = await db.occurrences.where('threadId').equals(threadId).toArray()
  const days = Array.from(new Set(occurrences.map((occurrence) => occurrence.day)))
  const results: ExerciseOccurrence[] = []
  for (const day of days) {
    const snapshot = await loadDaySnapshot(day)
    const taskById = new Map(snapshot.tasks.map((task) => [task.id, task]))
    const tagsByBlock = groupBy(snapshot.tags, (row) => row.blockId)
    const roleOf = (taskId: string): WorkoutRole | undefined =>
      workoutRoleFromTagIds((tagsByBlock.get(taskId) ?? []).map((row) => row.tagId))
    for (const occurrence of occurrences.filter((item) => item.day === day)) {
      const exercise = taskById.get(occurrence.rootBlockId)
      if (!exercise || roleOf(exercise.id) !== 'exercise') continue
      const sets = snapshot.tasks.filter((task) => task.parentTaskId === exercise.id && roleOf(task.id) === 'set')
      let workoutTaskId: string | undefined
      let parentId = exercise.parentTaskId
      while (parentId) {
        if (roleOf(parentId) === 'workout') { workoutTaskId = parentId; break }
        parentId = taskById.get(parentId)?.parentTaskId
      }
      results.push({
        day,
        exerciseTaskId: exercise.id,
        workoutTaskId,
        status: exercise.status,
        totalSets: sets.length,
        completedSets: sets.filter((set) => set.status === 'done').length,
        skippedSets: sets.filter((set) => set.status === 'canceled').length,
      })
    }
  }
  return results.sort((a, b) => b.day.localeCompare(a.day))
}

export async function getRecentWorkouts(limit: number): Promise<WorkoutView[]> {
  if (limit <= 0) return []
  const days = await db.days.orderBy('date').reverse().toArray()
  const workouts: WorkoutView[] = []
  for (const day of days) {
    workouts.push(...await getWorkoutsForDay(day.date))
    if (workouts.length >= limit) break
  }
  return workouts.slice(0, limit)
}
