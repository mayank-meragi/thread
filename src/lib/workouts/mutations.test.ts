import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, initializeDatabase, saveDay, setBlockProperty } from '../../db'
import { setTaskStatus } from '../tasks'
import {
  addExercise,
  addSet,
  createWorkout,
  deleteWorkoutItem,
  duplicateSet,
  skipExercise,
  skipSet,
  updateSet,
} from './mutations'
import { getWorkout } from './selectors'
import { WORKOUT_SYSTEM_TAGS } from './systemTags'

const DATE = '2026-09-01'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await initializeDatabase(DATE)
})

afterAll(() => db.close())

async function tasksInOrder() {
  return db.tasks.where('day').equals(DATE).sortBy('order')
}

describe('workout authoring mutations', () => {
  it('creates a workout / exercise / set tree with the protected structural tags', async () => {
    const workoutId = await createWorkout({ day: DATE, title: 'Push Day' })
    const exerciseId = await addExercise(workoutId, 'Bench Press')
    const firstSet = await addSet(exerciseId)
    const secondSet = await addSet(exerciseId)

    const markdown = (await db.days.get(DATE))?.markdown ?? ''
    expect(markdown).toContain('- [ ] #[workout] [[Push Day]]')
    expect(markdown).toContain('  - [ ] #[exercise] [[Bench Press]]')
    expect(markdown).toContain('    - [ ] #[set] Set 1')
    expect(markdown).toContain('    - [ ] #[set] Set 2')
    expect(await db.blockTags.get(`${workoutId}:${WORKOUT_SYSTEM_TAGS.workout}`)).toBeDefined()
    expect(await db.blockTags.get(`${exerciseId}:${WORKOUT_SYSTEM_TAGS.exercise}`)).toBeDefined()
    expect(await db.blockTags.get(`${firstSet}:${WORKOUT_SYSTEM_TAGS.set}`)).toBeDefined()
    expect(secondSet).not.toBe(firstSet)
  })

  it('defaults an untitled workout to a plain "Workout" task', async () => {
    const workoutId = await createWorkout({ day: DATE })
    expect((await db.tasks.get(workoutId))?.text).toContain('Workout')
    expect((await db.days.get(DATE))?.markdown).toContain('- [ ] #[workout] Workout')
  })

  it('rejects misplaced authoring calls', async () => {
    const workoutId = await createWorkout({ day: DATE, title: 'Legs' })
    const exerciseId = await addExercise(workoutId, 'Squat')
    await expect(addExercise(exerciseId, 'Nested')).rejects.toThrow('not a workout.')
    await expect(addSet(workoutId)).rejects.toThrow('not a workout exercise')
    await expect(addExercise(workoutId, '   ')).rejects.toThrow('needs a name')
  })
})

describe('updateSet', () => {
  it('writes measurements as block properties without rewriting the set title', async () => {
    const workoutId = await createWorkout({ day: DATE, title: 'Push Day' })
    const exerciseId = await addExercise(workoutId, 'Bench Press')
    const setId = await addSet(exerciseId)

    await updateSet(setId, { load: 60, loadUnit: 'kg', reps: 8, rpe: 7 })

    const props = await db.blockProperties.where('blockId').equals(setId).toArray()
    const byId = new Map(props.map((row) => [row.propertyId, row.value]))
    expect(byId.get('set-load')).toBe(60)
    expect(byId.get('set-load-unit')).toBe('kg')
    expect(byId.get('set-reps')).toBe(8)
    expect(byId.get('set-rpe')).toBe(7)
    expect((await db.tasks.get(setId))?.text).toContain('Set 1')
    expect((await db.days.get(DATE))?.markdown).toContain('- [ ] #[set] Set 1')
  })

  it('validates measurements against the schema rules', async () => {
    const workoutId = await createWorkout({ day: DATE, title: 'Push Day' })
    const exerciseId = await addExercise(workoutId, 'Bench Press')
    const setId = await addSet(exerciseId)

    await expect(updateSet(setId, { reps: -1 })).rejects.toThrow('cannot be negative')
    await expect(updateSet(setId, { reps: 8.5 })).rejects.toThrow('whole number')
    await expect(updateSet(setId, { rpe: 11 })).rejects.toThrow('between 1 and 10')
    await expect(updateSet(setId, { load: 40 })).rejects.toThrow('load unit')
    await expect(updateSet(setId, { distance: 400 })).rejects.toThrow('distance unit')
    expect(await db.blockProperties.where('blockId').equals(setId).count()).toBe(0)
  })

  it('clears a measurement when passed null and keeps the paired unit rule satisfied', async () => {
    const workoutId = await createWorkout({ day: DATE, title: 'Push Day' })
    const exerciseId = await addExercise(workoutId, 'Bench Press')
    const setId = await addSet(exerciseId)
    await updateSet(setId, { load: 60, loadUnit: 'kg' })

    await updateSet(setId, { load: null })

    const props = await db.blockProperties.where('blockId').equals(setId).toArray()
    expect(props.map((row) => row.propertyId)).toEqual(['set-load-unit'])
  })
})

describe('duplicate / skip / delete', () => {
  it('duplicateSet copies the set properties and descriptive tags', async () => {
    await saveDay(DATE, [
      '- [ ] #[workout] [[Push Day]]',
      '  - [ ] #[exercise] [[Bench Press]]',
      '    - [ ] #[set] #[warmup] Set 1',
    ].join('\n'))
    const [, , setId] = (await tasksInOrder()).map((task) => task.id)
    await setBlockProperty(setId, 'set-load', 40)
    await setBlockProperty(setId, 'set-load-unit', 'kg')

    const copyId = await duplicateSet(setId)

    const copyProps = new Map((await db.blockProperties.where('blockId').equals(copyId).toArray()).map((row) => [row.propertyId, row.value]))
    expect(copyProps.get('set-load')).toBe(40)
    expect(copyProps.get('set-load-unit')).toBe('kg')
    const copyTags = (await db.blockTags.where('blockId').equals(copyId).toArray()).map((row) => row.tagId)
    expect(copyTags).toContain(WORKOUT_SYSTEM_TAGS.set)
    expect(copyTags).toContain('warmup')
  })

  it('skipSet and skipExercise cancel through the existing status path', async () => {
    const workoutId = await createWorkout({ day: DATE, title: 'Push Day' })
    const exerciseId = await addExercise(workoutId, 'Bench Press')
    const setId = await addSet(exerciseId)

    await skipSet(setId)
    expect((await db.tasks.get(setId))?.status).toBe('canceled')

    await skipExercise(exerciseId)
    expect((await db.tasks.get(exerciseId))?.status).toBe('canceled')
  })

  it('deleteWorkoutItem removes the whole subtree and refuses non-workout tasks', async () => {
    const workoutId = await createWorkout({ day: DATE, title: 'Push Day' })
    const exerciseId = await addExercise(workoutId, 'Bench Press')
    const firstSet = await addSet(exerciseId)
    const secondSet = await addSet(exerciseId)

    await deleteWorkoutItem(exerciseId)

    const view = await getWorkout(workoutId)
    expect(view?.exercises).toHaveLength(0)
    expect(await db.tasks.get(exerciseId)).toBeUndefined()
    expect(await db.tasks.get(firstSet)).toBeUndefined()
    expect(await db.tasks.get(secondSet)).toBeUndefined()

    await saveDay(DATE, `${(await db.days.get(DATE))?.markdown}\n- [ ] Plain task`)
    const plainId = (await tasksInOrder()).at(-1)!.id
    await expect(deleteWorkoutItem(plainId)).rejects.toThrow('not part of a workout')
  })
})

describe('retry safety', () => {
  it('re-running updateSet with the same values is a no-op', async () => {
    const workoutId = await createWorkout({ day: DATE, title: 'Push Day' })
    const exerciseId = await addExercise(workoutId, 'Bench Press')
    const setId = await addSet(exerciseId)
    await updateSet(setId, { reps: 5 })
    await setTaskStatus(setId, 'done')

    await updateSet(setId, { reps: 5 })

    expect((await db.tasks.get(setId))?.status).toBe('done')
    const setProps = (await db.blockProperties.where('blockId').equals(setId).toArray())
      .filter((row) => row.propertyId.startsWith('set-'))
    expect(setProps.map((row) => [row.propertyId, row.value])).toEqual([['set-reps', 5]])
  })
})
