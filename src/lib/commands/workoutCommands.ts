import { z } from 'zod'
import { db, type PropertyValue } from '../../db'
import { isoToday } from '../dates'
import { applyGuideUpdate, planGuideUpdate, type ExerciseGuideInput } from '../exerciseGuide'
import { slugifyThread } from '../outline'
import {
  ActiveWorkoutConflictError,
  completeSet,
  finishWorkout,
  startWorkout,
} from '../workouts/lifecycle'
import {
  addExercise,
  addSet,
  assertValidSetMeasurements,
  createWorkout,
  deleteWorkoutItem,
  skipSet,
  updateSet,
  type SetPropertyInput,
} from '../workouts/mutations'
import { describeSet, stripStructuralTag, workoutLensState } from '../workouts/presentation'
import { getActiveWorkout, getWorkoutsForDay } from '../workouts/selectors'
import type { WorkoutExerciseView, WorkoutView } from '../workouts/types'
import { resolveThread, threadTarget } from './resolve'
import { workoutBuildResultSchema, workoutEditResultSchema, workoutGuideResultSchema, workoutLifecycleResultSchema } from './schemas'
import { defineCommand, type CommandChange, type CommandDefinition, type CommandTarget } from './types'

// ---------------------------------------------------------------------------
// Shared schema + helpers
// ---------------------------------------------------------------------------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

const SET_PROPERTY_BY_KEY: Record<keyof SetPropertyInput, string> = {
  load: 'set-load',
  loadUnit: 'set-load-unit',
  reps: 'set-reps',
  rpe: 'set-rpe',
  durationSeconds: 'set-duration-seconds',
  distance: 'set-distance',
  distanceUnit: 'set-distance-unit',
}

const setInputSchema = z.object({
  load: z.number().nonnegative().optional(),
  loadUnit: z.enum(['kg', 'lb']).optional(),
  reps: z.number().int().nonnegative().optional(),
  rpe: z.number().min(1).max(10).optional(),
  durationSeconds: z.number().nonnegative().optional(),
  distance: z.number().nonnegative().optional(),
  distanceUnit: z.enum(['m', 'km', 'mi']).optional(),
}).strict()

type SetInput = z.infer<typeof setInputSchema>

const exerciseGuideInputSchema = z.object({
  summary: z.string().trim().min(1).optional(),
  primaryMuscles: z.array(z.string()).optional(),
  secondaryMuscles: z.array(z.string()).optional(),
  equipment: z.array(z.string()).optional(),
  setup: z.string().trim().min(1).optional(),
  execution: z.string().trim().min(1).optional(),
  cues: z.string().trim().min(1).optional(),
  commonMistakes: z.string().trim().min(1).optional(),
  safetyNotes: z.string().trim().min(1).optional(),
}).strict()

const exerciseInputSchema = z.object({
  name: z.string().trim().min(1),
  sets: z.array(setInputSchema).min(1).max(12),
  guide: exerciseGuideInputSchema.optional(),
}).strict()

/** Friendly keys → the `set-*` block-property ids `assertValidSetMeasurements` / `updateSet` expect. */
function measurementMap(set: SetInput): Map<string, PropertyValue> {
  const map = new Map<string, PropertyValue>()
  for (const key of Object.keys(SET_PROPERTY_BY_KEY) as Array<keyof SetPropertyInput>) {
    const value = set[key]
    if (value !== undefined && value !== null) map.set(SET_PROPERTY_BY_KEY[key], value)
  }
  return map
}

function hasMeasurement(set: SetInput): boolean {
  return measurementMap(set).size > 0
}

/** Validate every set up front so `execute` never throws a measurement error mid-build. */
function validateSet(exerciseName: string, index: number, set: SetInput): SetPropertyInput {
  try {
    assertValidSetMeasurements(measurementMap(set))
  } catch (error) {
    throw new Error(`"${exerciseName}" set ${index + 1}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  return set as SetPropertyInput
}

function summariesFor(sets: SetInput[]): string[] {
  return sets.map((set) => describeSet(measurementMap(set)) || 'set')
}

function workoutTitleOf(view: WorkoutView): string {
  return view.thread?.title ?? stripStructuralTag(view.task.text, 'workout') ?? 'Workout'
}

function exerciseNameOf(view: WorkoutExerciseView): string {
  return view.exerciseThread?.title ?? stripStructuralTag(view.task.text, 'exercise') ?? 'Exercise'
}

// A workout's task id is created by Markdown block-identity reconciliation and
// is not predictable at preview time, so commands address their target by
// natural key (day + optional title) and the preview uses a synthetic,
// versionless target id — which `plan.ts` correctly reads as "will be created".
function workoutTarget(day: string, title: string): CommandTarget {
  return { kind: 'workout', id: `${day}:${slugifyThread(title)}`, label: title }
}

async function resolveDayWorkout(input: { day?: string; workout?: string }): Promise<{ day: string; view: WorkoutView }> {
  const day = input.day ?? isoToday()
  const workouts = await getWorkoutsForDay(day)
  if (workouts.length === 0) throw new Error(`No workout exists on ${day}.`)
  if (input.workout) {
    const wanted = input.workout.trim().toLocaleLowerCase()
    const match = workouts.find((view) => workoutTitleOf(view).toLocaleLowerCase() === wanted)
    if (!match) throw new Error(`No workout titled "${input.workout}" on ${day}.`)
    return { day, view: match }
  }
  if (workouts.length > 1) throw new Error(`${workouts.length} workouts exist on ${day}; pass "workout" to choose one.`)
  return { day, view: workouts[0] }
}

function findExercise(view: WorkoutView, name: string): WorkoutExerciseView {
  const wanted = name.trim().toLocaleLowerCase()
  const match = view.exercises.find((exercise) => exerciseNameOf(exercise).toLocaleLowerCase() === wanted)
  if (!match) throw new Error(`No exercise "${name}" in "${workoutTitleOf(view)}".`)
  return match
}

interface PlannedExercise {
  name: string
  sets: SetPropertyInput[]
  summaries: string[]
  guide?: ExerciseGuideInput
}

function planExercises(exercises: z.infer<typeof exerciseInputSchema>[]): PlannedExercise[] {
  return exercises.map((exercise) => ({
    name: exercise.name,
    sets: exercise.sets.map((set, index) => validateSet(exercise.name, index, set)),
    summaries: summariesFor(exercise.sets),
    guide: exercise.guide,
  }))
}

async function writeExercises(workoutTaskId: string, exercises: PlannedExercise[]): Promise<number> {
  let setCount = 0
  for (const exercise of exercises) {
    const exerciseTaskId = await addExercise(workoutTaskId, exercise.name)
    if (exercise.guide) {
      const occurrence = await db.occurrences.where('rootBlockId').equals(exerciseTaskId).first()
      if (occurrence) {
        const changes = await planGuideUpdate(occurrence.threadId, exercise.guide)
        await applyGuideUpdate(occurrence.threadId, changes)
      }
    }
    for (const set of exercise.sets) {
      const setTaskId = await addSet(exerciseTaskId)
      if (hasMeasurement(set as SetInput)) await updateSet(setTaskId, set)
      setCount += 1
    }
  }
  return setCount
}

// ---------------------------------------------------------------------------
// Slice A — create / edit a day's workout
// ---------------------------------------------------------------------------

const buildDay = defineCommand({
  name: 'workout.buildDay',
  summary: 'Create one day’s workout: a #[workout] root with #[exercise] children and measured #[set] grandchildren.',
  category: 'workouts',
  keywords: ['workout', 'exercise', 'set', 'training', 'session', 'program', 'lift', 'reps', 'rpe'],
  example:
    'action workout.buildDay\n' +
    '  day: "2026-09-02"\n' +
    '  title: "Lower A"\n' +
    '  exercises:\n' +
    '    - name: "Back Squat"\n' +
    '      sets:\n' +
    '        - load: 100\n' +
    '          loadUnit: "kg"\n' +
    '          reps: 5\n' +
    '          rpe: 8\n' +
    '        - load: 100\n' +
    '          loadUnit: "kg"\n' +
    '          reps: 5\n' +
    '          rpe: 8',
  risk: 'write',
  idempotency: 'receipt-required',
  inputSchema: z.object({
    day: z.string().regex(DAY_RE).optional(),
    title: z.string().trim().min(1),
    exercises: z.array(exerciseInputSchema).min(1).max(12),
  }).strict(),
  outputSchema: workoutBuildResultSchema,
  resolve: async (input) => {
    const day = input.day ?? isoToday()
    const existing = await getWorkoutsForDay(day)
    if (existing.length > 0) {
      throw new Error(
        `${day} already has a workout ("${workoutTitleOf(existing[0])}"). Use workout.addExercises or workout.updateExercise instead.`,
      )
    }
    const exercises = planExercises(input.exercises)
    return {
      day,
      title: input.title,
      exercises,
      setCount: exercises.reduce((total, exercise) => total + exercise.sets.length, 0),
    }
  },
  preview: (resolved) => {
    const target = workoutTarget(resolved.day, resolved.title)
    return {
      summary: `Build “${resolved.title}” for ${resolved.day}`,
      changes: [
        {
          kind: 'create',
          target,
          description: `Create workout “${resolved.title}” on ${resolved.day} — ${resolved.exercises.length} exercise(s), ${resolved.setCount} set(s)`,
          after: { title: resolved.title },
        },
        ...resolved.exercises.map((exercise) => ({
          kind: 'create' as const,
          target,
          field: exercise.name,
          description: `${exercise.sets.length} set(s): ${exercise.summaries.join(' · ')}`,
        })),
        ...resolved.exercises.filter((exercise) => exercise.guide).map((exercise) => ({
          kind: 'update' as const,
          target,
          field: `${exercise.name} guide`,
          description: `Set guide fields: ${Object.keys(exercise.guide!).join(', ')}`,
        })),
      ],
    }
  },
  execute: async (resolved) => {
    const workout = await createWorkout({ day: resolved.day, title: resolved.title })
    const setCount = await writeExercises(workout, resolved.exercises)
    return { workout, day: resolved.day, exerciseCount: resolved.exercises.length, setCount }
  },
})

const addExercises = defineCommand({
  name: 'workout.addExercises',
  summary: 'Add exercises (with sets) to the workout that already exists on a day.',
  category: 'workouts',
  keywords: ['workout', 'exercise', 'add', 'append', 'accessory', 'superset'],
  example:
    'action workout.addExercises\n' +
    '  day: "2026-09-02"\n' +
    '  exercises:\n' +
    '    - name: "Face Pull"\n' +
    '      sets:\n' +
    '        - reps: 15\n' +
    '        - reps: 15\n' +
    '        - reps: 15',
  risk: 'write',
  idempotency: 'receipt-required',
  inputSchema: z.object({
    day: z.string().regex(DAY_RE).optional(),
    workout: z.string().trim().min(1).optional(),
    exercises: z.array(exerciseInputSchema).min(1).max(12),
  }).strict(),
  outputSchema: workoutEditResultSchema,
  resolve: async (input) => {
    const { day, view } = await resolveDayWorkout(input)
    return { day, workoutTaskId: view.task.id, title: workoutTitleOf(view), exercises: planExercises(input.exercises) }
  },
  preview: (resolved) => {
    const target = workoutTarget(resolved.day, resolved.title)
    return {
      summary: `Add ${resolved.exercises.length} exercise(s) to “${resolved.title}”`,
      changes: [
        ...resolved.exercises.map((exercise) => ({
          kind: 'append' as const,
          target,
          field: exercise.name,
          description: `Add “${exercise.name}” — ${exercise.sets.length} set(s): ${exercise.summaries.join(' · ')}`,
        })),
        ...resolved.exercises.filter((exercise) => exercise.guide).map((exercise) => ({
          kind: 'update' as const,
          target,
          field: `${exercise.name} guide`,
          description: `Set guide fields: ${Object.keys(exercise.guide!).join(', ')}`,
        })),
      ],
    }
  },
  execute: async (resolved) => {
    await writeExercises(resolved.workoutTaskId, resolved.exercises)
    return { workout: resolved.workoutTaskId, added: resolved.exercises.length, updated: 0, removed: 0 }
  },
})

const updateExercise = defineCommand({
  name: 'workout.updateExercise',
  summary: 'Rebuild one exercise’s set list: update matching sets, add missing ones, skip extras.',
  category: 'workouts',
  keywords: ['workout', 'exercise', 'set', 'adjust', 'update', 'change', 'edit', 'progression'],
  example:
    'action workout.updateExercise\n' +
    '  day: "2026-09-02"\n' +
    '  exercise: "Back Squat"\n' +
    '  sets:\n' +
    '    - load: 102.5\n' +
    '      loadUnit: "kg"\n' +
    '      reps: 5\n' +
    '      rpe: 8\n' +
    '    - load: 102.5\n' +
    '      loadUnit: "kg"\n' +
    '      reps: 5\n' +
    '      rpe: 8',
  risk: 'destructive',
  idempotency: 'receipt-required',
  inputSchema: z.object({
    day: z.string().regex(DAY_RE).optional(),
    workout: z.string().trim().min(1).optional(),
    exercise: z.string().trim().min(1),
    sets: z.array(setInputSchema).min(1).max(12),
  }).strict(),
  outputSchema: workoutEditResultSchema,
  resolve: async (input) => {
    const { day, view } = await resolveDayWorkout(input)
    const exercise = findExercise(view, input.exercise)
    return {
      day,
      title: workoutTitleOf(view),
      workoutTaskId: view.task.id,
      exerciseTaskId: exercise.task.id,
      name: exerciseNameOf(exercise),
      current: exercise.sets.map((setView) => ({ id: setView.task.id, summary: describeSet(setView.properties) || 'set' })),
      sets: input.sets.map((set, index) => validateSet(input.exercise, index, set)),
      summaries: summariesFor(input.sets),
    }
  },
  preview: (resolved) => {
    const target = workoutTarget(resolved.day, resolved.title)
    const changes: CommandChange[] = []
    const max = Math.max(resolved.current.length, resolved.sets.length)
    for (let index = 0; index < max; index += 1) {
      const before = resolved.current[index]
      const after = resolved.summaries[index]
      const field = `${resolved.name} set ${index + 1}`
      if (before && after !== undefined) {
        changes.push({ kind: 'update', target, field, description: `Set ${index + 1}: ${before.summary} → ${after}`, before: before.summary, after })
      } else if (after !== undefined) {
        changes.push({ kind: 'create', target, field, description: `Add set ${index + 1}: ${after}` })
      } else if (before) {
        changes.push({ kind: 'remove', target, field, description: `Skip set ${index + 1} (${before.summary})`, before: before.summary })
      }
    }
    return {
      summary: `Adjust “${resolved.name}” in “${resolved.title}”`,
      changes,
      warnings: resolved.sets.length < resolved.current.length
        ? [`${resolved.current.length - resolved.sets.length} existing set(s) will be marked skipped.`]
        : undefined,
    }
  },
  execute: async (resolved) => {
    let added = 0
    let updated = 0
    let removed = 0
    const max = Math.max(resolved.current.length, resolved.sets.length)
    for (let index = 0; index < max; index += 1) {
      if (index < resolved.sets.length && index < resolved.current.length) {
        await updateSet(resolved.current[index].id, resolved.sets[index])
        updated += 1
      } else if (index < resolved.sets.length) {
        const setTaskId = await addSet(resolved.exerciseTaskId)
        await updateSet(setTaskId, resolved.sets[index])
        added += 1
      } else {
        await skipSet(resolved.current[index].id)
        removed += 1
      }
    }
    return { workout: resolved.workoutTaskId, exercise: resolved.name, added, updated, removed }
  },
})

const removeExercise = defineCommand({
  name: 'workout.removeExercise',
  summary: 'Delete an exercise (and its sets) from a day’s workout.',
  category: 'workouts',
  keywords: ['workout', 'exercise', 'remove', 'delete', 'drop', 'swap'],
  example: 'action workout.removeExercise\n  day: "2026-09-02"\n  exercise: "Leg Press"',
  risk: 'destructive',
  idempotency: 'natural',
  inputSchema: z.object({
    day: z.string().regex(DAY_RE).optional(),
    workout: z.string().trim().min(1).optional(),
    exercise: z.string().trim().min(1),
  }).strict(),
  outputSchema: workoutEditResultSchema,
  resolve: async (input) => {
    const { day, view } = await resolveDayWorkout(input)
    const exercise = findExercise(view, input.exercise)
    return {
      day,
      title: workoutTitleOf(view),
      workoutTaskId: view.task.id,
      exerciseTaskId: exercise.task.id,
      name: exerciseNameOf(exercise),
      setCount: exercise.sets.length,
    }
  },
  preview: (resolved) => ({
    summary: `Remove “${resolved.name}” from “${resolved.title}”`,
    changes: [{
      kind: 'remove',
      target: workoutTarget(resolved.day, resolved.title),
      field: resolved.name,
      description: `Delete “${resolved.name}” and its ${resolved.setCount} set(s)`,
    }],
  }),
  execute: async (resolved) => {
    await deleteWorkoutItem(resolved.exerciseTaskId)
    return { workout: resolved.workoutTaskId, exercise: resolved.name, added: 0, updated: 0, removed: 1 }
  },
})

// ---------------------------------------------------------------------------
// Slice B — live-session actions
// ---------------------------------------------------------------------------

const start = defineCommand({
  name: 'workout.start',
  summary: 'Mark a day’s workout in progress and stamp its start time.',
  category: 'workouts',
  keywords: ['workout', 'start', 'begin', 'session'],
  example: 'action workout.start\n  day: "2026-09-02"',
  risk: 'write',
  idempotency: 'natural',
  inputSchema: z.object({
    day: z.string().regex(DAY_RE).optional(),
    workout: z.string().trim().min(1).optional(),
  }).strict(),
  outputSchema: workoutLifecycleResultSchema,
  resolve: async (input) => {
    const { day, view } = await resolveDayWorkout(input)
    const active = await getActiveWorkout()
    if (active && active.task.id !== view.task.id) {
      throw new Error(`"${workoutTitleOf(active)}" is already in progress. Finish or reopen it first.`)
    }
    return { day, title: workoutTitleOf(view), workoutTaskId: view.task.id, state: workoutLensState(view) }
  },
  preview: (resolved) => ({
    summary: `Start “${resolved.title}”`,
    changes: resolved.state === 'active'
      ? []
      : [{
          kind: 'update',
          target: workoutTarget(resolved.day, resolved.title),
          field: 'status',
          description: `Set “${resolved.title}” in progress`,
          before: resolved.state,
          after: 'active',
        }],
  }),
  execute: async (resolved) => {
    try {
      await startWorkout(resolved.workoutTaskId)
    } catch (error) {
      if (error instanceof ActiveWorkoutConflictError) {
        throw new Error('Another workout is already in progress. Finish or reopen it first.', { cause: error })
      }
      throw error
    }
    return { workout: resolved.workoutTaskId, status: 'active' }
  },
})

const logSet = defineCommand({
  name: 'workout.logSet',
  summary: 'Record what was performed on one set (by exercise + set number) and mark it done.',
  category: 'workouts',
  keywords: ['workout', 'set', 'log', 'record', 'complete', 'performed', 'actual'],
  example:
    'action workout.logSet\n' +
    '  day: "2026-09-02"\n' +
    '  exercise: "Back Squat"\n' +
    '  set: 1\n' +
    '  load: 100\n' +
    '  loadUnit: "kg"\n' +
    '  reps: 5\n' +
    '  rpe: 8',
  risk: 'write',
  idempotency: 'natural',
  inputSchema: z.object({
    day: z.string().regex(DAY_RE).optional(),
    workout: z.string().trim().min(1).optional(),
    exercise: z.string().trim().min(1),
    set: z.number().int().min(1),
    load: z.number().nonnegative().optional(),
    loadUnit: z.enum(['kg', 'lb']).optional(),
    reps: z.number().int().nonnegative().optional(),
    rpe: z.number().min(1).max(10).optional(),
    durationSeconds: z.number().nonnegative().optional(),
    distance: z.number().nonnegative().optional(),
    distanceUnit: z.enum(['m', 'km', 'mi']).optional(),
    complete: z.boolean().default(true),
  }).strict(),
  outputSchema: workoutLifecycleResultSchema,
  resolve: async (input) => {
    const { day, view } = await resolveDayWorkout(input)
    const exercise = findExercise(view, input.exercise)
    const target = exercise.sets[input.set - 1]
    if (!target) {
      throw new Error(`"${exerciseNameOf(exercise)}" has ${exercise.sets.length} set(s); set ${input.set} does not exist.`)
    }
    const patch: SetInput = {
      load: input.load,
      loadUnit: input.loadUnit,
      reps: input.reps,
      rpe: input.rpe,
      durationSeconds: input.durationSeconds,
      distance: input.distance,
      distanceUnit: input.distanceUnit,
    }
    const merged = new Map(target.properties)
    for (const [id, value] of measurementMap(patch)) merged.set(id, value)
    try {
      assertValidSetMeasurements(merged)
    } catch (error) {
      throw new Error(`"${exerciseNameOf(exercise)}" set ${input.set}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    return {
      day,
      title: workoutTitleOf(view),
      workoutTaskId: view.task.id,
      exerciseName: exerciseNameOf(exercise),
      setTaskId: target.task.id,
      setNumber: input.set,
      before: describeSet(target.properties) || 'set',
      after: describeSet(merged) || 'set',
      patch,
      complete: input.complete,
      alreadyDone: target.task.status === 'done',
    }
  },
  preview: (resolved) => ({
    summary: `Log ${resolved.exerciseName} set ${resolved.setNumber}`,
    changes: [{
      kind: 'update',
      target: workoutTarget(resolved.day, resolved.title),
      field: `${resolved.exerciseName} set ${resolved.setNumber}`,
      description: `${resolved.before} → ${resolved.after}${resolved.complete ? ' · mark done' : ''}`,
      before: resolved.before,
      after: resolved.after,
    }],
  }),
  execute: async (resolved) => {
    if (hasMeasurement(resolved.patch)) await updateSet(resolved.setTaskId, resolved.patch)
    if (resolved.complete && !resolved.alreadyDone) await completeSet(resolved.setTaskId)
    return { workout: resolved.workoutTaskId, status: resolved.complete ? 'set-completed' : 'set-logged', set: resolved.setTaskId }
  },
})

const finish = defineCommand({
  name: 'workout.finish',
  summary: 'Complete a day’s workout and stamp its finish time.',
  category: 'workouts',
  keywords: ['workout', 'finish', 'complete', 'done', 'end', 'wrap'],
  example: 'action workout.finish\n  day: "2026-09-02"\n  unresolvedSets: "cancel"',
  risk: 'write',
  idempotency: 'natural',
  inputSchema: z.object({
    day: z.string().regex(DAY_RE).optional(),
    workout: z.string().trim().min(1).optional(),
    unresolvedSets: z.enum(['cancel', 'leave']).default('leave'),
  }).strict(),
  outputSchema: workoutLifecycleResultSchema,
  resolve: async (input) => {
    const { day, view } = await resolveDayWorkout(input)
    const unresolved = view.exercises
      .flatMap((exercise) => exercise.sets)
      .filter((set) => set.task.status !== 'done' && set.task.status !== 'canceled').length
    return {
      day,
      title: workoutTitleOf(view),
      workoutTaskId: view.task.id,
      state: workoutLensState(view),
      unresolved,
      unresolvedSets: input.unresolvedSets,
    }
  },
  preview: (resolved) => ({
    summary: `Finish “${resolved.title}”`,
    changes: [{
      kind: 'update',
      target: workoutTarget(resolved.day, resolved.title),
      field: 'status',
      description: `Complete “${resolved.title}”`,
      before: resolved.state,
      after: 'completed',
    }],
    warnings: resolved.unresolved > 0
      ? [`${resolved.unresolved} set(s) are unresolved and will be ${resolved.unresolvedSets === 'cancel' ? 'marked skipped' : 'left pending'}.`]
      : undefined,
  }),
  execute: async (resolved) => {
    await finishWorkout(resolved.workoutTaskId, { unresolvedSets: resolved.unresolvedSets })
    return { workout: resolved.workoutTaskId, status: 'completed' }
  },
})

const refreshExerciseGuide = defineCommand({
  name: 'workout.refreshExerciseGuide',
  summary: 'Regenerate or fill in an exercise’s reusable guide (summary, muscles, equipment, cues, etc.) without touching fields the user has edited.',
  category: 'workouts',
  keywords: ['exercise', 'guide', 'muscles', 'equipment', 'cues', 'refresh', 'regenerate'],
  example:
    'action workout.refreshExerciseGuide\n' +
    '  exercise: "Back Squat"\n' +
    '  guide:\n' +
    '    summary: "A bilateral squat pattern..."\n' +
    '    primaryMuscles: ["quadriceps", "glutes"]',
  risk: 'write',
  idempotency: 'receipt-required',
  inputSchema: z.object({
    exercise: z.string().trim().min(1),
    guide: exerciseGuideInputSchema,
  }).strict(),
  outputSchema: workoutGuideResultSchema,
  resolve: async (input, context) => {
    const thread = await resolveThread(input.exercise, undefined, context)
    const changes = await planGuideUpdate(thread.id, input.guide)
    return { thread, changes }
  },
  preview: ({ thread, changes }) => ({
    summary: changes.length
      ? `Update ${changes.length} guide field(s) for “${thread.title}”`
      : `No guide changes for “${thread.title}” — every proposed field is already set explicitly or unchanged`,
    changes: changes.map((change) => ({
      kind: 'update' as const,
      target: threadTarget(thread),
      field: change.fieldName,
      description: `${change.before === undefined ? 'Set' : 'Update'} “${change.fieldName}”`,
      before: change.before,
      after: change.after,
    })),
  }),
  execute: async ({ thread, changes }) => {
    await applyGuideUpdate(thread.id, changes)
    return { thread: thread.id, changed: changes.length > 0, fields: changes.map((change) => change.propertyId) }
  },
})

export const workoutCommands: readonly CommandDefinition[] = [
  buildDay,
  addExercises,
  updateExercise,
  removeExercise,
  start,
  logSet,
  finish,
  refreshExerciseGuide,
]
