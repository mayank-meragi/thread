import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, initializeDatabase, setThreadProperty } from '../../db'
import { compileThreadScript } from '../threadscript/compiler'
import { dispatchApprovedProposal } from '../threadscript/dispatch'
import { resolvePlan } from '../threadscript/plan'
import { createProposal } from '../threadscript/proposals'
import { addExercise, addSet, createWorkout, updateSet } from '../workouts/mutations'
import { getWorkout, getWorkoutsForDay } from '../workouts/selectors'
import { commandRegistry, projectCommandOutput } from './index'

const DAY = '2026-09-01'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await initializeDatabase(DAY)
})

afterAll(() => db.close())

async function seedWorkout(title = 'Push Day') {
  const workout = await createWorkout({ day: DAY, title })
  const bench = await addExercise(workout, 'Bench Press')
  const setId = await addSet(bench)
  await updateSet(setId, { load: 60, loadUnit: 'kg', reps: 8 })
  await addSet(bench)
  return { workout, bench }
}

const BUILD_INPUT = {
  day: DAY,
  title: 'Lower A',
  exercises: [
    { name: 'Back Squat', sets: [{ load: 100, loadUnit: 'kg', reps: 5, rpe: 8 }, { load: 100, loadUnit: 'kg', reps: 5 }] },
    { name: 'Romanian Deadlift', sets: [{ load: 80, loadUnit: 'kg', reps: 8 }] },
  ],
}

describe('workout.buildDay', () => {
  it('previews without writing, then builds the whole subtree on execute', async () => {
    const before = await db.tasks.count()
    const prepared = await commandRegistry.prepare('workout.buildDay', BUILD_INPUT)

    expect(await db.tasks.count()).toBe(before)
    expect(prepared.preview.changes[0]).toMatchObject({ kind: 'create', target: { kind: 'workout', label: 'Lower A' } })
    expect(prepared.preview.changes.map((change) => change.field)).toEqual([undefined, 'Back Squat', 'Romanian Deadlift'])

    const result = await commandRegistry.execute(prepared, { idempotencyKey: 'p:0' })
    expect(result).toEqual({ workout: expect.any(String), day: DAY, exerciseCount: 2, setCount: 3 })

    const view = await getWorkout((result as { workout: string }).workout)
    expect(view?.exercises.map((exercise) => exercise.exerciseThread?.title)).toEqual(['Back Squat', 'Romanian Deadlift'])
    expect(view?.exercises[0].sets).toHaveLength(2)
    const props = view?.exercises[0].sets[0].properties
    expect(props?.get('set-load')).toBe(100)
    expect(props?.get('set-load-unit')).toBe('kg')
    expect(props?.get('set-reps')).toBe(5)
    expect(props?.get('set-rpe')).toBe(8)
  })

  it('rejects a day that already has a workout, and writes nothing', async () => {
    await seedWorkout()
    await expect(commandRegistry.prepare('workout.buildDay', BUILD_INPUT)).rejects.toThrow(/already has a workout/i)
  })

  it('rejects invalid measurements at prepare time', async () => {
    await expect(commandRegistry.prepare('workout.buildDay', {
      day: DAY, title: 'Bad', exercises: [{ name: 'Curl', sets: [{ load: 20 }] }],
    })).rejects.toThrow(/load unit/i)
    await expect(commandRegistry.prepare('workout.buildDay', {
      day: DAY, title: 'Bad', exercises: [{ name: 'Curl', sets: [{ rpe: 12 }] }],
    })).rejects.toThrow()
    expect((await getWorkoutsForDay(DAY)).length).toBe(0)
  })

  it('produces byte-identical preview changes on re-resolution', async () => {
    const a = await commandRegistry.prepare('workout.buildDay', BUILD_INPUT)
    const b = await commandRegistry.prepare('workout.buildDay', BUILD_INPUT)
    expect(JSON.stringify(a.preview.changes)).toBe(JSON.stringify(b.preview.changes))
  })

  it('projects the scalar output shape without the non-deterministic id', async () => {
    const prepared = await commandRegistry.prepare('workout.buildDay', BUILD_INPUT)
    expect(projectCommandOutput(prepared)).toEqual({ workout: undefined, day: DAY, exerciseCount: 2, setCount: 3 })
  })
})

describe('workout edit commands', () => {
  it('workout.addExercises appends to the existing workout', async () => {
    await seedWorkout()
    const prepared = await commandRegistry.prepare('workout.addExercises', {
      day: DAY,
      exercises: [{ name: 'Incline Press', sets: [{ load: 40, loadUnit: 'kg', reps: 10 }, { load: 40, loadUnit: 'kg', reps: 10 }] }],
    })
    expect(prepared.preview.changes[0]).toMatchObject({ kind: 'append', field: 'Incline Press' })
    await commandRegistry.execute(prepared, { idempotencyKey: 'p:0' })

    const view = (await getWorkoutsForDay(DAY))[0]
    expect(view.exercises.map((exercise) => exercise.exerciseThread?.title)).toEqual(['Bench Press', 'Incline Press'])
  })

  it('workout.updateExercise updates matching sets, adds missing, skips extras', async () => {
    await seedWorkout() // Bench Press has 2 sets (set 1 measured, set 2 empty)
    const prepared = await commandRegistry.prepare('workout.updateExercise', {
      day: DAY,
      exercise: 'Bench Press',
      sets: [
        { load: 62.5, loadUnit: 'kg', reps: 8 },
        { load: 62.5, loadUnit: 'kg', reps: 8 },
        { load: 62.5, loadUnit: 'kg', reps: 6 },
      ],
    })
    // 2 existing -> update x2, add x1
    expect(prepared.preview.changes.map((change) => change.kind)).toEqual(['update', 'update', 'create'])
    const result = await commandRegistry.execute(prepared, { idempotencyKey: 'p:0' }) as { added: number; updated: number; removed: number }
    expect(result).toMatchObject({ added: 1, updated: 2, removed: 0 })

    const view = (await getWorkoutsForDay(DAY))[0]
    expect(view.exercises[0].sets).toHaveLength(3)
    expect(view.exercises[0].sets[0].properties.get('set-load')).toBe(62.5)
  })

  it('workout.updateExercise skips extra existing sets when given fewer', async () => {
    await seedWorkout()
    const prepared = await commandRegistry.prepare('workout.updateExercise', {
      day: DAY, exercise: 'Bench Press', sets: [{ load: 65, loadUnit: 'kg', reps: 5 }],
    })
    expect(prepared.preview.changes.map((change) => change.kind)).toEqual(['update', 'remove'])
    expect(prepared.preview.warnings?.[0]).toMatch(/marked skipped/i)
    await commandRegistry.execute(prepared, { idempotencyKey: 'p:0' })

    const view = (await getWorkoutsForDay(DAY))[0]
    expect(view.exercises[0].sets[1].task.status).toBe('canceled')
  })

  it('workout.removeExercise deletes the exercise subtree', async () => {
    await seedWorkout()
    await commandRegistry.prepare('workout.addExercises', {
      day: DAY, exercises: [{ name: 'Fly', sets: [{ reps: 12 }] }],
    }).then((prepared) => commandRegistry.execute(prepared, { idempotencyKey: 'p:0' }))

    const prepared = await commandRegistry.prepare('workout.removeExercise', { day: DAY, exercise: 'Fly' })
    expect(prepared.preview.changes[0]).toMatchObject({ kind: 'remove', field: 'Fly' })
    await commandRegistry.execute(prepared, { idempotencyKey: 'p:1' })

    const view = (await getWorkoutsForDay(DAY))[0]
    expect(view.exercises.map((exercise) => exercise.exerciseThread?.title)).toEqual(['Bench Press'])
  })

  it('errors when the target workout or exercise cannot be found', async () => {
    await expect(commandRegistry.prepare('workout.addExercises', {
      day: DAY, exercises: [{ name: 'X', sets: [{ reps: 1 }] }],
    })).rejects.toThrow(/no workout exists/i)

    await seedWorkout()
    await expect(commandRegistry.prepare('workout.updateExercise', {
      day: DAY, exercise: 'Nonexistent', sets: [{ reps: 1 }],
    })).rejects.toThrow(/no exercise/i)
  })
})

describe('exercise guide payload', () => {
  it('workout.buildDay writes guide fields as source "automation", leaving unset fields untouched', async () => {
    const prepared = await commandRegistry.prepare('workout.buildDay', {
      day: DAY,
      title: 'Lower A',
      exercises: [
        {
          name: 'Back Squat',
          sets: [{ load: 100, loadUnit: 'kg', reps: 5 }],
          guide: { summary: 'A bilateral squat pattern', primaryMuscles: ['quadriceps', 'glutes'] },
        },
      ],
    })
    expect(prepared.preview.changes.some((change) => change.field === 'Back Squat guide')).toBe(true)
    await commandRegistry.execute(prepared, { idempotencyKey: 'p:0' })

    expect(await db.threadProperties.get('back-squat:exercise-summary')).toMatchObject({ value: 'A bilateral squat pattern', source: 'automation' })
    expect(await db.threadProperties.get('back-squat:exercise-primary-muscles')).toMatchObject({ value: ['quadriceps', 'glutes'], source: 'automation' })
    // Fields not in the guide input stay whatever the auto-applied blank template set them to.
    expect(await db.threadProperties.get('back-squat:exercise-cues')).toMatchObject({ value: '', source: 'default' })
  })

  it('workout.addExercises drops a guide field the exercise thread already has explicit, keeps the rest', async () => {
    await seedWorkout()
    await setThreadProperty('bench-press', 'exercise-summary', 'My own summary', 'explicit')

    const prepared = await commandRegistry.prepare('workout.addExercises', {
      day: DAY,
      exercises: [{
        name: 'Bench Press',
        sets: [{ reps: 8 }],
        guide: { summary: 'AI summary', cues: 'Squeeze the bar' },
      }],
    })
    await commandRegistry.execute(prepared, { idempotencyKey: 'p:0' })

    expect(await db.threadProperties.get('bench-press:exercise-summary')).toMatchObject({ value: 'My own summary', source: 'explicit' })
    expect(await db.threadProperties.get('bench-press:exercise-cues')).toMatchObject({ value: 'Squeeze the bar', source: 'automation' })
  })

  it('a legacy exercise entry with no "guide" key executes identically to today', async () => {
    const prepared = await commandRegistry.prepare('workout.buildDay', BUILD_INPUT)
    const result = await commandRegistry.execute(prepared, { idempotencyKey: 'p:0' })
    expect(result).toEqual({ workout: expect.any(String), day: DAY, exerciseCount: 2, setCount: 3 })
  })
})

describe('workout.refreshExerciseGuide', () => {
  it('previews only fields that will change, excludes explicit fields, and writes as automation', async () => {
    await seedWorkout()
    await setThreadProperty('bench-press', 'exercise-cues', 'user cue', 'explicit')

    const prepared = await commandRegistry.prepare('workout.refreshExerciseGuide', {
      exercise: 'Bench Press',
      guide: { summary: 'A pressing movement', cues: 'AI cue' },
    })

    expect(prepared.preview.changes).toHaveLength(1)
    expect(prepared.preview.changes[0]).toMatchObject({ field: 'Summary', before: '', after: 'A pressing movement' })

    const result = await commandRegistry.execute(prepared, { idempotencyKey: 'p:0' }) as { thread: string; changed: boolean; fields: string[] }
    expect(result).toMatchObject({ thread: 'bench-press', changed: true, fields: ['exercise-summary'] })

    expect(await db.threadProperties.get('bench-press:exercise-summary')).toMatchObject({ value: 'A pressing movement', source: 'automation' })
    expect(await db.threadProperties.get('bench-press:exercise-cues')).toMatchObject({ value: 'user cue', source: 'explicit' })
  })

  it('previews an empty change list and a "no changes" summary when nothing is left to update', async () => {
    await seedWorkout()
    await setThreadProperty('bench-press', 'exercise-summary', 'same', 'automation')

    const prepared = await commandRegistry.prepare('workout.refreshExerciseGuide', {
      exercise: 'Bench Press',
      guide: { summary: 'same' },
    })

    expect(prepared.preview.changes).toEqual([])
    expect(prepared.preview.summary).toMatch(/no guide changes/i)
  })

  it('rejects a nonexistent exercise thread', async () => {
    await expect(commandRegistry.prepare('workout.refreshExerciseGuide', {
      exercise: 'Nonexistent Exercise',
      guide: { summary: 'x' },
    })).rejects.toThrow(/was not found/i)
  })
})

describe('workout lifecycle commands', () => {
  it('workout.start marks the workout in progress and stamps the start time', async () => {
    const { workout } = await seedWorkout()
    const prepared = await commandRegistry.prepare('workout.start', { day: DAY })
    expect(prepared.preview.changes[0]).toMatchObject({ field: 'status', after: 'active' })
    await commandRegistry.execute(prepared, { idempotencyKey: 'p:0' })

    expect((await db.tasks.get(workout))?.status).toBe('in_progress')
    expect(await db.blockProperties.where('[blockId+propertyId]').equals([workout, 'workout-started-at']).first()).toBeDefined()
  })

  it('workout.logSet records measurements and marks the set done', async () => {
    await seedWorkout()
    const prepared = await commandRegistry.prepare('workout.logSet', {
      day: DAY, exercise: 'Bench Press', set: 2, load: 60, loadUnit: 'kg', reps: 6, rpe: 9,
    })
    expect(prepared.preview.changes[0]).toMatchObject({ field: 'Bench Press set 2' })
    await commandRegistry.execute(prepared, { idempotencyKey: 'p:0' })

    const view = (await getWorkoutsForDay(DAY))[0]
    expect(view.exercises[0].sets[1].task.status).toBe('done')
    expect(view.exercises[0].sets[1].properties.get('set-load')).toBe(60)
  })

  it('workout.logSet rejects a set number that does not exist', async () => {
    await seedWorkout()
    await expect(commandRegistry.prepare('workout.logSet', {
      day: DAY, exercise: 'Bench Press', set: 9, reps: 5,
    })).rejects.toThrow(/set 9 does not exist/i)
  })

  it('workout.finish completes the workout and cancels unresolved sets when asked', async () => {
    const { workout } = await seedWorkout()
    const prepared = await commandRegistry.prepare('workout.finish', { day: DAY, unresolvedSets: 'cancel' })
    expect(prepared.preview.warnings?.[0]).toMatch(/unresolved/i)
    await commandRegistry.execute(prepared, { idempotencyKey: 'p:0' })

    expect((await db.tasks.get(workout))?.status).toBe('done')
    const view = (await getWorkoutsForDay(DAY))[0]
    expect(view.exercises[0].sets.every((set) => set.task.status === 'done' || set.task.status === 'canceled')).toBe(true)
  })
})

describe('workout.buildDay through the full ThreadScript pipeline', () => {
  const SOURCE = [
    'action workout.buildDay',
    `  day: "${DAY}"`,
    '  title: "Lower A"',
    '  exercises:',
    '    - name: "Back Squat"',
    '      sets:',
    '        - load: 100',
    '          loadUnit: "kg"',
    '          reps: 5',
    '          rpe: 8',
    '        - load: 100',
    '          loadUnit: "kg"',
    '          reps: 5',
    '          rpe: 8',
    '',
  ].join('\n')

  it('compiles, resolves, and dispatches a confirmed proposal exactly once', async () => {
    const compiled = compileThreadScript(SOURCE)
    expect(compiled.risk).toBe('write')
    const resolved = await resolvePlan(compiled)
    const id = await createProposal({ sessionId: 'session-1', personaId: 'workout-coach', compiled, resolved })

    const first = await dispatchApprovedProposal(id)
    expect(first.status).toBe('completed')
    const view = (await getWorkoutsForDay(DAY))[0]
    expect(view.exercises[0].exerciseThread?.title).toBe('Back Squat')
    expect(view.exercises[0].sets).toHaveLength(2)

    const second = await dispatchApprovedProposal(id)
    expect(second.status).toBe('completed')
    expect((await getWorkoutsForDay(DAY)).length).toBe(1)
  })
})
