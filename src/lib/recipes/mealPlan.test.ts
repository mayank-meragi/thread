import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, initializeDatabase } from '../../db'
import { addStep, createRecipeThread, planMeal, removeMealPlan, updateMealPlanType } from './mutations'
import { getMealPlanForDay, getMealPlanRange, getShoppingList } from './selectors'

const MONDAY = '2026-09-07'
const TUESDAY = '2026-09-08'
const WEDNESDAY = '2026-09-09'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await initializeDatabase(MONDAY)
})

afterAll(() => db.close())

async function seedPancakes(): Promise<string> {
  const threadId = await createRecipeThread({ title: 'Pancakes', servings: 4 })
  await addStep(threadId, 'Whisk @eggs{2} and @milk{300%ml} together.')
  await addStep(threadId, 'Add @flour{200%g} and mix until smooth.')
  return threadId
}

async function seedOmelette(): Promise<string> {
  const threadId = await createRecipeThread({ title: 'Omelette', servings: 2 })
  await addStep(threadId, 'Whisk @eggs{3} with @salt{}.')
  return threadId
}

describe('meal planning', () => {
  it('plans a meal onto a day and lists it back sorted by meal type', async () => {
    const pancakes = await seedPancakes()
    await planMeal(pancakes, MONDAY, 'dinner')
    await planMeal(pancakes, MONDAY, 'breakfast')

    const markdown = (await db.days.get(MONDAY))?.markdown ?? ''
    expect(markdown).toContain('- [ ] #[meal-plan] [[Pancakes]]')

    const plans = await getMealPlanForDay(MONDAY)
    expect(plans).toHaveLength(2)
    expect(plans.map((plan) => plan.mealType)).toEqual(['breakfast', 'dinner'])
    expect(plans[0].recipeTitle).toBe('Pancakes')
    expect(plans[0].recipeThreadId).toBe(pancakes)
  })

  it('rejects planning a meal for a thread that is not a recipe', async () => {
    const { createThread } = await import('../../db')
    const plainThreadId = await createThread('Just Notes')
    await expect(planMeal(plainThreadId, MONDAY, 'lunch')).rejects.toThrow('not a recipe')
  })

  it('updates a meal-plan type and removes it', async () => {
    const pancakes = await seedPancakes()
    const taskId = await planMeal(pancakes, MONDAY, 'breakfast')
    await updateMealPlanType(taskId, 'snack')
    expect((await getMealPlanForDay(MONDAY))[0].mealType).toBe('snack')

    await removeMealPlan(taskId)
    expect(await getMealPlanForDay(MONDAY)).toHaveLength(0)
  })

  it('excludes meal-plan tasks the same way cook-session tasks are excluded', async () => {
    const pancakes = await seedPancakes()
    const taskId = await planMeal(pancakes, MONDAY, 'breakfast')
    const { cookRolesByBlockId, isCookRole } = await import('./integration')
    const tags = await db.blockTags.where('day').equals(MONDAY).toArray()
    const roles = cookRolesByBlockId(tags)
    expect(isCookRole(roles.get(taskId))).toBe(true)
  })

  it('lists planned meals across a day range, oldest first', async () => {
    const pancakes = await seedPancakes()
    const omelette = await seedOmelette()
    await planMeal(omelette, WEDNESDAY, 'breakfast')
    await planMeal(pancakes, MONDAY, 'dinner')
    await planMeal(pancakes, TUESDAY, 'lunch')

    const range = await getMealPlanRange(MONDAY, WEDNESDAY)
    expect(range.map((plan) => plan.day)).toEqual([MONDAY, TUESDAY, WEDNESDAY])
  })
})

describe('shopping list', () => {
  it('aggregates ingredients across every planned meal in range, deduped by name', async () => {
    const pancakes = await seedPancakes()
    const omelette = await seedOmelette()
    await planMeal(pancakes, MONDAY, 'breakfast')
    await planMeal(omelette, TUESDAY, 'dinner')

    const list = await getShoppingList(MONDAY, TUESDAY)
    const eggs = list.find((item) => item.name === 'eggs')
    expect(eggs?.quantity).toBe(5) // 2 (pancakes) + 3 (omelette)
    expect(eggs?.plannedCount).toBe(2)
    expect(list.find((item) => item.name === 'milk')?.plannedCount).toBe(1)
    expect(list.find((item) => item.name === 'salt')?.quantity).toBeUndefined()
  })

  it('returns an empty list when nothing is planned in range', async () => {
    expect(await getShoppingList(MONDAY, WEDNESDAY)).toEqual([])
  })

  it('ignores a meal plan whose recipe has since been removed from the thread table', async () => {
    const pancakes = await seedPancakes()
    await planMeal(pancakes, MONDAY, 'breakfast')
    await db.threads.delete(pancakes)
    expect(await getShoppingList(MONDAY, MONDAY)).toEqual([])
  })
})
