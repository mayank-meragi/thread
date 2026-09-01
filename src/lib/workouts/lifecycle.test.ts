import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, initializeDatabase, setBlockProperty } from '../../db'
import { setTaskStatus } from '../tasks'
import {
  ActiveWorkoutConflictError,
  UnresolvedSetsError,
  cancelWorkout,
  completeSet,
  finishWorkout,
  reopenWorkout,
  startWorkout,
} from './lifecycle'
import { addExercise, addSet, createWorkout } from './mutations'
import { getWorkout } from './selectors'

const DATE = '2026-09-01'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await initializeDatabase(DATE)
})

afterAll(() => db.close())

async function buildWorkout(sets = 3) {
  const workoutId = await createWorkout({ day: DATE, title: 'Push Day' })
  const exerciseId = await addExercise(workoutId, 'Bench Press')
  const setIds: string[] = []
  for (let i = 0; i < sets; i += 1) setIds.push(await addSet(exerciseId))
  return { workoutId, exerciseId, setIds }
}

async function propValue(blockId: string, propertyId: string) {
  return (await db.blockProperties.where('[blockId+propertyId]').equals([blockId, propertyId]).first())?.value
}

describe('startWorkout', () => {
  it('sets the root in progress and stamps the start time once', async () => {
    const { workoutId } = await buildWorkout(1)

    await startWorkout(workoutId)
    const firstStart = await propValue(workoutId, 'workout-started-at')
    expect((await db.tasks.get(workoutId))?.status).toBe('in_progress')
    expect(firstStart).toBeTypeOf('string')

    await startWorkout(workoutId) // retry stays a no-op
    expect(await propValue(workoutId, 'workout-started-at')).toBe(firstStart)
  })

  it('reports another in-progress workout as a typed conflict', async () => {
    const first = await buildWorkout(1)
    const second = await buildWorkout(1)
    await startWorkout(first.workoutId)

    await expect(startWorkout(second.workoutId)).rejects.toBeInstanceOf(ActiveWorkoutConflictError)
    try {
      await startWorkout(second.workoutId)
    } catch (error) {
      expect((error as ActiveWorkoutConflictError).conflict.activeWorkoutTaskId).toBe(first.workoutId)
    }
  })
})

describe('completeSet', () => {
  it('marks the set done and returns the next pending set', async () => {
    const { workoutId, setIds } = await buildWorkout(3)
    await startWorkout(workoutId)

    expect(await completeSet(setIds[0])).toBe(setIds[1])
    expect(await completeSet(setIds[1])).toBe(setIds[2])
    expect(await completeSet(setIds[2])).toBeUndefined()
    expect((await db.tasks.get(setIds[0]))?.status).toBe('done')
  })

  it('refuses to complete a set with invalid measurements', async () => {
    const { setIds } = await buildWorkout(1)
    await setBlockProperty(setIds[0], 'set-load', 50) // load without a unit

    await expect(completeSet(setIds[0])).rejects.toThrow('load unit')
    expect((await db.tasks.get(setIds[0]))?.status).toBe('not_started')
  })

  it('drives derived parent progress through the existing task path', async () => {
    const { workoutId, exerciseId, setIds } = await buildWorkout(2)
    await startWorkout(workoutId)

    await completeSet(setIds[0])
    expect((await db.tasks.get(exerciseId))?.status).toBe('in_progress')
    await completeSet(setIds[1])
    expect((await db.tasks.get(exerciseId))?.status).toBe('done')
  })
})

describe('finishWorkout', () => {
  it('requires a decision about unresolved sets', async () => {
    const { workoutId, setIds } = await buildWorkout(2)
    await startWorkout(workoutId)
    await completeSet(setIds[0])

    await expect(finishWorkout(workoutId)).rejects.toBeInstanceOf(UnresolvedSetsError)
    try {
      await finishWorkout(workoutId)
    } catch (error) {
      expect((error as UnresolvedSetsError).setTaskIds).toEqual([setIds[1]])
    }
  })

  it('cancels unresolved sets when asked and stamps the finish time', async () => {
    const { workoutId, setIds } = await buildWorkout(2)
    await startWorkout(workoutId)
    await completeSet(setIds[0])

    await finishWorkout(workoutId, { unresolvedSets: 'cancel' })

    expect((await db.tasks.get(workoutId))?.status).toBe('done')
    expect((await db.tasks.get(setIds[1]))?.status).toBe('canceled')
    expect(await propValue(workoutId, 'workout-finished-at')).toBeTypeOf('string')
  })

  it('leaves unresolved sets pending while the root is manually done', async () => {
    const { workoutId, setIds } = await buildWorkout(2)
    await startWorkout(workoutId)
    await completeSet(setIds[0])

    await finishWorkout(workoutId, { unresolvedSets: 'leave' })

    expect((await db.tasks.get(workoutId))?.status).toBe('done')
    expect((await db.tasks.get(workoutId))?.statusSource).toBe('manual')
    expect((await db.tasks.get(setIds[1]))?.status).toBe('not_started')
  })

  it('is safe to retry and keeps the original finish time', async () => {
    const { workoutId, setIds } = await buildWorkout(1)
    await startWorkout(workoutId)
    await completeSet(setIds[0])
    await finishWorkout(workoutId)
    const finishedAt = await propValue(workoutId, 'workout-finished-at')

    await finishWorkout(workoutId)
    expect(await propValue(workoutId, 'workout-finished-at')).toBe(finishedAt)
  })
})

describe('cancelWorkout', () => {
  it('cancels only the root unless descendants are explicitly included', async () => {
    const { workoutId, setIds } = await buildWorkout(2)
    await startWorkout(workoutId)

    await cancelWorkout(workoutId)
    expect((await db.tasks.get(workoutId))?.status).toBe('canceled')
    expect((await db.tasks.get(setIds[0]))?.status).toBe('not_started')

    await cancelWorkout(workoutId, { cancelDescendants: true })
    expect((await db.tasks.get(setIds[0]))?.status).toBe('canceled')
    expect((await db.tasks.get(setIds[1]))?.status).toBe('canceled')
  })
})

describe('reopenWorkout', () => {
  it('clears the finish time, returns to in progress, and keeps completed sets', async () => {
    const { workoutId, setIds } = await buildWorkout(2)
    await startWorkout(workoutId)
    await completeSet(setIds[0])
    await finishWorkout(workoutId, { unresolvedSets: 'cancel' })

    await reopenWorkout(workoutId)

    expect((await db.tasks.get(workoutId))?.status).toBe('in_progress')
    expect(await propValue(workoutId, 'workout-finished-at')).toBeUndefined()
    expect((await db.tasks.get(setIds[0]))?.status).toBe('done')

    const view = await getWorkout(workoutId)
    expect(view?.diagnostics).toEqual([])
  })

  it('lets a reopened workout be finished again with a fresh timestamp', async () => {
    const { workoutId, setIds } = await buildWorkout(1)
    await startWorkout(workoutId)
    await completeSet(setIds[0])
    await finishWorkout(workoutId)
    const firstFinish = await propValue(workoutId, 'workout-finished-at')

    await reopenWorkout(workoutId)
    await new Promise((resolve) => setTimeout(resolve, 2))
    await finishWorkout(workoutId)

    expect(await propValue(workoutId, 'workout-finished-at')).not.toBe(firstFinish)
  })
})

describe('malformed hierarchy', () => {
  it('completeSet still resolves the workout for a set nested under a stray task', async () => {
    const { workoutId, exerciseId, setIds } = await buildWorkout(1)
    await startWorkout(workoutId)
    // Manually override the exercise to a non-standard status; the set should still complete.
    await setTaskStatus(exerciseId, 'blocked')

    expect(await completeSet(setIds[0])).toBeUndefined()
    expect((await db.tasks.get(setIds[0]))?.status).toBe('done')
  })
})
