import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, initializeDatabase } from '../db'
import {
  archivePersona,
  ensureWorkoutCoachPersona,
  repairPersonaThreads,
  updatePersona,
  WORKOUT_COACH_PERSONA_ID,
  WORKOUT_COACH_PROMPT_VERSION,
} from './personas'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

afterAll(() => db.close())

describe('Workout Coach persona seed', () => {
  it('is seeded by initializeDatabase with a companion thread and note', async () => {
    await initializeDatabase('2026-09-01')

    const persona = await db.personas.get(WORKOUT_COACH_PERSONA_ID)
    expect(persona).toMatchObject({ name: 'Workout Coach', icon: 'Dumbbell', threadId: 'workout-coach' })
    expect(persona?.systemPrompt).toContain('workout.buildDay')
    expect(await db.threads.get('workout-coach')).toMatchObject({ title: 'Workout Coach' })
    expect(await db.threadNotes.get('workout-coach')).toBeDefined()
  })

  it('is idempotent — re-running keeps one row with the original createdAt', async () => {
    await initializeDatabase('2026-09-01')
    const first = await db.personas.get(WORKOUT_COACH_PERSONA_ID)

    await ensureWorkoutCoachPersona()
    await repairPersonaThreads()

    const again = await db.personas.get(WORKOUT_COACH_PERSONA_ID)
    expect(await db.personas.where('id').equals(WORKOUT_COACH_PERSONA_ID).count()).toBe(1)
    expect(again?.createdAt).toBe(first?.createdAt)
    expect(again?.threadId).toBe('workout-coach')
  })

  it('cannot be archived', async () => {
    await initializeDatabase('2026-09-01')
    await expect(archivePersona(WORKOUT_COACH_PERSONA_ID)).rejects.toThrow(/built-in persona/i)
    expect((await db.personas.get(WORKOUT_COACH_PERSONA_ID))?.archivedAt).toBeUndefined()
  })

  it('upgrades an untouched shipped prompt to the current version', async () => {
    await initializeDatabase('2026-09-01')
    // Simulate an install seeded before this prompt revision.
    await db.personas.update(WORKOUT_COACH_PERSONA_ID, { systemPrompt: 'old prompt', systemPromptVersion: 1 })

    await ensureWorkoutCoachPersona()

    const persona = await db.personas.get(WORKOUT_COACH_PERSONA_ID)
    expect(persona?.systemPromptVersion).toBe(WORKOUT_COACH_PROMPT_VERSION)
    expect(persona?.systemPrompt).not.toBe('old prompt')
    expect(persona?.systemPrompt).toContain('HOLISTIC')
  })

  it('upgrades an untouched prompt from the prior shipped version to the current one', async () => {
    await initializeDatabase('2026-09-01')
    // Simulate an install seeded on the pre-guide prompt revision.
    await db.personas.update(WORKOUT_COACH_PERSONA_ID, { systemPromptVersion: WORKOUT_COACH_PROMPT_VERSION - 1 })

    await ensureWorkoutCoachPersona()

    const persona = await db.personas.get(WORKOUT_COACH_PERSONA_ID)
    expect(persona?.systemPromptVersion).toBe(WORKOUT_COACH_PROMPT_VERSION)
    expect(persona?.systemPrompt).toContain('workout.refreshExerciseGuide')
  })

  it('never re-seeds a prompt the user has edited', async () => {
    await initializeDatabase('2026-09-01')
    await updatePersona(WORKOUT_COACH_PERSONA_ID, { systemPrompt: 'my own coaching prompt' })
    expect((await db.personas.get(WORKOUT_COACH_PERSONA_ID))?.systemPromptVersion).toBe(0)

    await ensureWorkoutCoachPersona()

    expect((await db.personas.get(WORKOUT_COACH_PERSONA_ID))?.systemPrompt).toBe('my own coaching prompt')
  })
})
