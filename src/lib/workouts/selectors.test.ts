import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, initializeDatabase, saveDay, setBlockProperty } from '../../db'
import { createWorkoutSubtask, createWorkoutTask } from '../tasks'
import { getExerciseOccurrences, getWorkout, getWorkoutForBlock, getWorkoutRole, getWorkoutsForDay } from './selectors'
import { setTaskStatus } from '../tasks'
import { WORKOUT_SYSTEM_TAGS } from './systemTags'

const DATE = '2026-09-01'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await initializeDatabase(DATE)
})

afterAll(() => db.close())

describe('workout selectors', () => {
  it('assembles a workout from existing tasks, tags, properties, links, and notes', async () => {
    await saveDay(DATE, [
      '- [ ] #[workout] [[Push Day]]',
      '  - [ ] #[exercise] [[Bench Press]]',
      '    - Keep the shoulder blades set',
      '    - [x] #[set] Set 1',
      '    - [ ] #[set] Set 2',
    ].join('\n'))
    const tasks = await db.tasks.where('day').equals(DATE).sortBy('order')
    const [workout, exercise, firstSet] = tasks
    await setBlockProperty(firstSet.id, 'set-load', 60)
    await setBlockProperty(firstSet.id, 'set-load-unit', 'kg')
    await setBlockProperty(firstSet.id, 'set-reps', 8)

    const view = await getWorkout(workout.id)

    expect(await getWorkoutRole(exercise.id)).toBe('exercise')
    expect(view?.thread).toEqual({ id: 'push-day', title: 'Push Day' })
    expect(view?.exercises).toHaveLength(1)
    expect(view?.exercises[0].exerciseThread).toEqual({ id: 'bench-press', title: 'Bench Press' })
    expect(view?.exercises[0].sets).toHaveLength(2)
    expect(view?.exercises[0].sets[0].properties.get('set-load')).toBe(60)
    expect(view?.exercises[0].sets[0].properties.get('set-load-unit')).toBe('kg')
    expect(view?.exercises[0].sets[0].properties.get('set-reps')).toBe(8)
    expect(view?.exercises[0].notes.map((note) => note.plainText)).toEqual(['Keep the shoulder blades set'])
    expect(view?.diagnostics).toEqual([])
    expect((await getWorkoutForBlock(firstSet.id))?.task.id).toBe(workout.id)
    expect(await getWorkoutsForDay(DATE)).toHaveLength(1)
  })

  it('reports missing exercise links and invalid set properties without rejecting the source', async () => {
    await saveDay(DATE, [
      '- [ ] #[workout] Training',
      '  - [ ] #[exercise] Bench variation',
      '    - [ ] #[set] Heavy set',
    ].join('\n'))
    const [workout, , set] = await db.tasks.where('day').equals(DATE).sortBy('order')
    await setBlockProperty(set.id, 'set-load', 80)
    await setBlockProperty(set.id, 'set-rpe', 11)

    const view = await getWorkout(workout.id)

    expect(view?.diagnostics.map((item) => item.code).sort()).toEqual(['invalid_set_properties', 'missing_exercise_link'])
  })
})

describe('getExerciseOccurrences', () => {
  it('reports each day an exercise thread appears, with set counts and completion', async () => {
    await saveDay(DATE, [
      '- [ ] #[workout] [[Push Day]]',
      '  - [ ] #[exercise] [[Bench Press]]',
      '    - [x] #[set] Set 1',
      '    - [x] #[set] Set 2',
      '    - [ ] #[set] Set 3',
    ].join('\n'))
    const [, exercise, , , thirdSet] = await db.tasks.where('day').equals(DATE).sortBy('order')
    await setTaskStatus(thirdSet.id, 'canceled')

    const occurrences = await getExerciseOccurrences('bench-press')

    expect(occurrences).toHaveLength(1)
    expect(occurrences[0]).toMatchObject({
      day: DATE,
      exerciseTaskId: exercise.id,
      totalSets: 3,
      completedSets: 2,
      skippedSets: 1,
    })
    expect(occurrences[0].workoutTaskId).toBeDefined()
  })

  it('ignores threads that are only linked from non-exercise blocks', async () => {
    await saveDay(DATE, '- A note about [[Bench Press]] form')
    expect(await getExerciseOccurrences('bench-press')).toEqual([])
  })
})

describe('workout task authoring helpers', () => {
  it('creates protected tagged task trees through the existing day write path', async () => {
    await saveDay(DATE, '- Existing note')

    const workoutId = await createWorkoutTask({ role: 'workout', text: 'Push Day', day: DATE })
    const exerciseId = await createWorkoutSubtask(workoutId, 'exercise', '[[Bench Press]]')
    const setId = await createWorkoutSubtask(exerciseId, 'set')

    expect((await db.days.get(DATE))?.markdown).toContain('- [ ] #[workout] Push Day')
    expect((await db.days.get(DATE))?.markdown).toContain('  - [ ] #[exercise] [[Bench Press]]')
    expect((await db.days.get(DATE))?.markdown).toContain('    - [ ] #[set] Set')
    expect(await db.blockTags.get(`${workoutId}:${WORKOUT_SYSTEM_TAGS.workout}`)).toBeDefined()
    expect(await db.blockTags.get(`${exerciseId}:${WORKOUT_SYSTEM_TAGS.exercise}`)).toBeDefined()
    expect(await db.blockTags.get(`${setId}:${WORKOUT_SYSTEM_TAGS.set}`)).toBeDefined()
  })
})
