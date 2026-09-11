import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, initializeDatabase } from '../../db'
import { addStep, createRecipeThread } from './mutations'
import {
  ActiveCookConflictError,
  cancelCook,
  completeCookStep,
  finishCook,
  reopenCook,
  skipCookStep,
  startCook,
  toggleCookIngredient,
  UnresolvedCookStepsError,
} from './lifecycle'
import { getActiveCookSession, getCookSession, getCookSessionForTask } from './selectors'

const DATE = '2026-09-01'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await initializeDatabase(DATE)
})

afterAll(() => db.close())

async function seedPancakes(): Promise<string> {
  const threadId = await createRecipeThread({ title: 'Pancakes', servings: 4 })
  await addStep(threadId, 'Whisk @eggs{2} and @milk{300%ml} together.')
  await addStep(threadId, 'Add @flour{200%g} and mix until smooth.')
  await addStep(threadId, 'Cook for ~{2%minutes} per side.')
  return threadId
}

describe('startCook', () => {
  it('instantiates a #[cook] tree with scaled ingredients and step durations', async () => {
    const threadId = await seedPancakes()
    const cookTaskId = await startCook(threadId, { day: DATE, servings: 8 })

    const markdown = (await db.days.get(DATE))?.markdown ?? ''
    expect(markdown).toContain('- [ ] #[cook] [[Pancakes]]')
    expect(markdown).toContain('#[cook-ingredient] eggs')
    expect(markdown).toContain('#[cook-step] Whisk @eggs{2} and @milk{300%ml} together.')

    const session = await getCookSession(cookTaskId)
    expect(session?.task.status).toBe('in_progress')
    expect(session?.properties.get('cook-servings')).toBe(8)
    expect(session?.ingredients.find((item) => item.task.text.includes('eggs'))?.quantity).toBe(4)
    expect(session?.ingredients.find((item) => item.task.text.includes('flour'))?.quantity).toBe(400)
    expect(session?.steps).toHaveLength(3)
    expect(session?.steps[2].durationSeconds).toBe(120)
  })

  it('defaults servings to the recipe base and refuses a second concurrent session', async () => {
    const threadId = await seedPancakes()
    const cookTaskId = await startCook(threadId, { day: DATE })
    const session = await getCookSession(cookTaskId)
    expect(session?.properties.get('cook-servings')).toBe(4)
    expect(session?.ingredients.find((item) => item.task.text.includes('eggs'))?.quantity).toBe(2)

    await expect(startCook(threadId, { day: DATE })).rejects.toBeInstanceOf(ActiveCookConflictError)
  })
})

describe('cook session flow', () => {
  it('gathers ingredients, completes steps in order, and finishes', async () => {
    const threadId = await seedPancakes()
    const cookTaskId = await startCook(threadId, { day: DATE })
    let session = await getCookSession(cookTaskId)
    const [first, second, third] = session!.steps

    await toggleCookIngredient(session!.ingredients[0].task.id, true)
    session = await getCookSession(cookTaskId)
    expect(session?.ingredients[0].task.status).toBe('done')

    const next = await completeCookStep(first.task.id)
    expect(next).toBe(second.task.id)

    await skipCookStep(second.task.id)
    const afterSkip = await getCookSession(cookTaskId)
    expect(afterSkip?.steps[1].task.status).toBe('canceled')

    await expect(finishCook(cookTaskId)).rejects.toBeInstanceOf(UnresolvedCookStepsError)

    await completeCookStep(third.task.id)
    await finishCook(cookTaskId)
    session = await getCookSession(cookTaskId)
    expect(session?.task.status).toBe('done')
    expect(session?.properties.get('cook-finished-at')).toBeTypeOf('string')
  })

  it('resolves the cook session from an ingredient or step task id', async () => {
    const threadId = await seedPancakes()
    const cookTaskId = await startCook(threadId, { day: DATE })
    const session = await getCookSession(cookTaskId)
    const fromStep = await getCookSessionForTask(session!.steps[0].task.id)
    expect(fromStep?.task.id).toBe(cookTaskId)
  })

  it('finishCook can cancel unresolved steps instead of throwing', async () => {
    const threadId = await seedPancakes()
    const cookTaskId = await startCook(threadId, { day: DATE })
    await finishCook(cookTaskId, { unresolvedSteps: 'cancel' })
    const session = await getCookSession(cookTaskId)
    expect(session?.steps.every((step) => step.task.status === 'canceled')).toBe(true)
  })

  it('cancel and reopen toggle the session lifecycle', async () => {
    const threadId = await seedPancakes()
    const cookTaskId = await startCook(threadId, { day: DATE })
    await cancelCook(cookTaskId)
    expect((await getCookSession(cookTaskId))?.task.status).toBe('canceled')

    // Once canceled, a new session can start.
    const secondCookTaskId = await startCook(threadId, { day: DATE })
    await finishCook(secondCookTaskId, { unresolvedSteps: 'cancel' })
    await reopenCook(secondCookTaskId)
    const reopened = await getCookSession(secondCookTaskId)
    expect(reopened?.task.status).toBe('in_progress')
    expect(reopened?.properties.has('cook-finished-at')).toBe(false)
  })

  it('getActiveCookSession finds the in-progress session for a day', async () => {
    const threadId = await seedPancakes()
    const cookTaskId = await startCook(threadId, { day: DATE })
    const active = await getActiveCookSession(DATE)
    expect(active?.task.id).toBe(cookTaskId)
  })
})
