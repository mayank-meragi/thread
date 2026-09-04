import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createThread, db, initializeDatabase, setThreadProperty } from '../db'
import {
  applyExerciseGuideToThreads,
  applyExerciseImageMatch,
  applyGuideUpdate,
  EXERCISE_GUIDE_PROPERTY_IDS,
  EXERCISE_GUIDE_TEMPLATE_ID,
  ensureExerciseGuideTemplate,
  matchExerciseImages,
  planGuideUpdate,
} from './exerciseGuide'

const DATE = '2026-09-02'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

afterAll(() => db.close())

describe('ensureExerciseGuideTemplate', () => {
  it('creates a template thread with all 9 guide properties blank, marked isTemplate', async () => {
    await ensureExerciseGuideTemplate()

    const thread = await db.threads.get(EXERCISE_GUIDE_TEMPLATE_ID)
    expect(thread).toMatchObject({ title: 'Exercise Guide', isTemplate: true })
    expect(await db.threadNotes.get(EXERCISE_GUIDE_TEMPLATE_ID)).toBeDefined()

    for (const propertyId of EXERCISE_GUIDE_PROPERTY_IDS) {
      const row = await db.threadProperties.get(`${EXERCISE_GUIDE_TEMPLATE_ID}:${propertyId}`)
      expect(row).toBeDefined()
      expect(row!.value).toEqual(propertyId.includes('muscles') || propertyId === 'exercise-equipment' ? [] : '')
    }
  })

  it('is idempotent -- a second call does not recreate or touch the thread', async () => {
    await ensureExerciseGuideTemplate()
    const first = await db.threads.get(EXERCISE_GUIDE_TEMPLATE_ID)

    await ensureExerciseGuideTemplate()
    const second = await db.threads.get(EXERCISE_GUIDE_TEMPLATE_ID)
    expect(second).toEqual(first)
    expect(await db.threads.where('id').equals(EXERCISE_GUIDE_TEMPLATE_ID).count()).toBe(1)
  })
})

describe('applyExerciseGuideToThreads', () => {
  it('seeds all 9 blank defaults as source "default" on a fresh exercise thread', async () => {
    await ensureExerciseGuideTemplate()
    const exercise = await createThread('Overhead Press')

    await applyExerciseGuideToThreads([{ id: exercise, title: 'Overhead Press' }])

    const rows = await db.threadProperties.where('threadId').equals(exercise).toArray()
    expect(rows.length).toBeGreaterThanOrEqual(EXERCISE_GUIDE_PROPERTY_IDS.length)
    expect(rows.every((row) => row.source === 'default')).toBe(true)
  })

  it('never touches a field the user has explicitly edited, even on repeated calls', async () => {
    await ensureExerciseGuideTemplate()
    const exercise = await createThread('Deadlift')
    await setThreadProperty(exercise, 'exercise-summary', 'My own notes', 'explicit')

    await applyExerciseGuideToThreads([{ id: exercise, title: 'Deadlift' }])
    await applyExerciseGuideToThreads([{ id: exercise, title: 'Deadlift' }])

    expect(await db.threadProperties.get(`${exercise}:exercise-summary`)).toMatchObject({ value: 'My own notes', source: 'explicit' })
  })
})

describe('matchExerciseImages', () => {
  it('matches an exact (case/punctuation-insensitive) exercise name and builds CDN URLs', () => {
    const urls = matchExerciseImages('barbell bench press')
    expect(urls).toBeDefined()
    expect(urls!.length).toBeGreaterThan(0)
    for (const url of urls!) expect(url.startsWith('https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db/exercises/')).toBe(true)
  })

  it('returns undefined for a title with no reasonable match', () => {
    expect(matchExerciseImages('Definitely Not A Real Exercise Name Xyzzy')).toBeUndefined()
  })
})

describe('applyExerciseImageMatch', () => {
  it('sets exercise-image-urls only on a match, and never overwrites an existing value', async () => {
    const matched = await createThread('Barbell Bench Press')
    await applyExerciseImageMatch(matched, 'Barbell Bench Press')
    const first = await db.threadProperties.get(`${matched}:exercise-image-urls`)
    expect(first).toMatchObject({ source: 'default' })
    expect((first!.value as string[]).length).toBeGreaterThan(0)

    // Calling again must not change it, even if it were possible to match differently.
    await applyExerciseImageMatch(matched, 'Barbell Bench Press')
    expect(await db.threadProperties.get(`${matched}:exercise-image-urls`)).toEqual(first)

    const unmatched = await createThread('Totally Made Up Exercise')
    await applyExerciseImageMatch(unmatched, 'Totally Made Up Exercise')
    expect(await db.threadProperties.get(`${unmatched}:exercise-image-urls`)).toBeUndefined()
  })

  it('never overwrites a user-edited value', async () => {
    const exercise = await createThread('Squat')
    await setThreadProperty(exercise, 'exercise-image-urls', ['https://example.com/mine.jpg'], 'explicit')

    await applyExerciseImageMatch(exercise, 'Squat')

    expect(await db.threadProperties.get(`${exercise}:exercise-image-urls`)).toMatchObject({ value: ['https://example.com/mine.jpg'], source: 'explicit' })
  })
})

describe('planGuideUpdate / applyGuideUpdate', () => {
  it('includes a field with no existing value as a "set" change', async () => {
    const exercise = await createThread('Row')
    const changes = await planGuideUpdate(exercise, { summary: 'A pulling movement' })
    expect(changes).toEqual([{ propertyId: 'exercise-summary', fieldName: 'Summary', before: undefined, after: 'A pulling movement' }])
  })

  it('includes a field with an existing "default" value that differs, as an update', async () => {
    const exercise = await createThread('Row 2')
    await setThreadProperty(exercise, 'exercise-summary', '', 'default')
    const changes = await planGuideUpdate(exercise, { summary: 'A pulling movement' })
    expect(changes).toEqual([{ propertyId: 'exercise-summary', fieldName: 'Summary', before: '', after: 'A pulling movement' }])
  })

  it('excludes a field whose existing value is "explicit", regardless of the proposed value', async () => {
    const exercise = await createThread('Row 3')
    await setThreadProperty(exercise, 'exercise-summary', 'user wrote this', 'explicit')
    const changes = await planGuideUpdate(exercise, { summary: 'AI proposal' })
    expect(changes).toEqual([])
  })

  it('excludes a field whose proposed value already matches the existing value', async () => {
    const exercise = await createThread('Row 4')
    await setThreadProperty(exercise, 'exercise-summary', 'same', 'automation')
    const changes = await planGuideUpdate(exercise, { summary: 'same' })
    expect(changes).toEqual([])
  })

  it('normalizes human-readable muscle/equipment labels (any case/punctuation) to stable option ids', async () => {
    const exercise = await createThread('Bird Dog')
    const changes = await planGuideUpdate(exercise, {
      primaryMuscles: ['Abs', 'glutes', 'Spinal Erectors'],
      equipment: ['Bodyweight'],
    })
    const primary = changes.find((change) => change.propertyId === 'exercise-primary-muscles')
    const equipment = changes.find((change) => change.propertyId === 'exercise-equipment')
    expect(primary?.after).toEqual(['abs', 'glutes', 'spinal-erectors'])
    expect(equipment?.after).toEqual(['bodyweight'])

    // Values already stable ids pass through untouched, and an unrecognized
    // one is left as-is (so validatePropertyValue rejects it with a clear
    // error, rather than the failure being silently swallowed here).
    const passthrough = await planGuideUpdate(exercise, { primaryMuscles: ['quadriceps', 'made-up-muscle'] })
    expect(passthrough[0].after).toEqual(['quadriceps', 'made-up-muscle'])
  })

  it('applyGuideUpdate writes every planned change with source "automation"', async () => {
    const exercise = await createThread('Row 5')
    const changes = await planGuideUpdate(exercise, { summary: 'text', primaryMuscles: ['lats'] })
    await applyGuideUpdate(exercise, changes)

    expect(await db.threadProperties.get(`${exercise}:exercise-summary`)).toMatchObject({ value: 'text', source: 'automation' })
    expect(await db.threadProperties.get(`${exercise}:exercise-primary-muscles`)).toMatchObject({ value: ['lats'], source: 'automation' })
  })
})

describe('initializeDatabase wiring', () => {
  it('seeds the Exercise Guide template as part of database initialization', async () => {
    await initializeDatabase(DATE)
    expect(await db.threads.get(EXERCISE_GUIDE_TEMPLATE_ID)).toMatchObject({ isTemplate: true })
  })
})
