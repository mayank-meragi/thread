import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, initializeDatabase } from '../../db'
import { getRecipe } from '../recipes/selectors'
import { commandRegistry } from './index'

const DAY = '2026-09-01'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await initializeDatabase(DAY)
})

afterAll(() => db.close())

const CREATE_INPUT = {
  title: 'Khichdi',
  servings: 4,
  prepMinutes: 10,
  cookMinutes: 25,
  category: ['dinner'],
  steps: [
    'Rinse @rice{1%cup} and @split moong dal{1/2%cup} together.',
    'In a #pressure cooker{}, heat @ghee{1%tbsp} and add @cumin, then cook for ~{3%whistles}.',
  ],
}

describe('recipe.create', () => {
  it('previews without writing, then creates the recipe thread with steps and properties on execute', async () => {
    const before = await db.threads.count()
    const prepared = await commandRegistry.prepare('recipe.create', CREATE_INPUT)

    expect(await db.threads.count()).toBe(before)
    expect(prepared.preview.changes[0]).toMatchObject({ kind: 'create', target: { label: 'Khichdi' } })

    const result = await commandRegistry.execute(prepared, { idempotencyKey: 'p:0' }) as { thread: string; created: boolean }
    expect(result.created).toBe(true)

    const recipe = await getRecipe(result.thread)
    expect(recipe?.steps).toHaveLength(2)
    expect(recipe?.properties.get('recipe-servings')).toBe(4)
    expect(recipe?.properties.get('recipe-prep-minutes')).toBe(10)
    expect(recipe?.properties.get('recipe-category')).toEqual(['dinner'])
    expect(recipe?.ingredients.map((ingredient) => ingredient.name)).toEqual(
      expect.arrayContaining(['rice', 'split moong dal', 'ghee', 'cumin']),
    )
  })

  it('rejects creating over a thread that is already a recipe', async () => {
    await commandRegistry.execute(await commandRegistry.prepare('recipe.create', CREATE_INPUT), { idempotencyKey: 'p:0' })
    await expect(commandRegistry.prepare('recipe.create', CREATE_INPUT)).rejects.toThrow(/already exists as a recipe/i)
  })
})

async function seedRecipe() {
  const prepared = await commandRegistry.prepare('recipe.create', CREATE_INPUT)
  const result = await commandRegistry.execute(prepared, { idempotencyKey: 's:0' }) as { thread: string }
  return result.thread
}

describe('recipe.addSteps', () => {
  it('appends steps without disturbing existing ones', async () => {
    const threadId = await seedRecipe()
    const prepared = await commandRegistry.prepare('recipe.addSteps', {
      recipe: 'Khichdi',
      steps: ['Garnish with @coriander and a squeeze of @lemon.'],
    })
    const result = await commandRegistry.execute(prepared, { idempotencyKey: 'p:1' }) as { thread: string; stepCount: number }
    expect(result.stepCount).toBe(3)
    const recipe = await getRecipe(threadId)
    expect(recipe?.steps[2].text).toContain('coriander')
  })

  it('rejects a recipe reference that is not a recipe thread', async () => {
    await expect(commandRegistry.prepare('recipe.addSteps', { recipe: 'Untitled', steps: ['x'] })).rejects.toThrow()
  })
})

describe('recipe.setSteps', () => {
  it('replaces the whole step list', async () => {
    const threadId = await seedRecipe()
    const prepared = await commandRegistry.prepare('recipe.setSteps', {
      recipe: 'Khichdi',
      steps: ['Rinse @rice{1.5%cup} well.'],
    })
    await commandRegistry.execute(prepared, { idempotencyKey: 'p:2' })
    const recipe = await getRecipe(threadId)
    expect(recipe?.steps).toHaveLength(1)
    expect(recipe?.steps[0].text).toContain('1.5')
  })
})

describe('recipe.updateStep / recipe.removeStep', () => {
  it('edits one step by position', async () => {
    const threadId = await seedRecipe()
    const prepared = await commandRegistry.prepare('recipe.updateStep', {
      recipe: 'Khichdi',
      step: 1,
      text: 'Rinse @rice{2%cup} thoroughly.',
    })
    await commandRegistry.execute(prepared, { idempotencyKey: 'p:3' })
    const recipe = await getRecipe(threadId)
    expect(recipe?.steps[0].text).toContain('thoroughly')
  })

  it('rejects an out-of-range step', async () => {
    await seedRecipe()
    await expect(commandRegistry.prepare('recipe.updateStep', { recipe: 'Khichdi', step: 9, text: 'x' })).rejects.toThrow(/does not exist/i)
  })

  it('removes one step by position', async () => {
    const threadId = await seedRecipe()
    const prepared = await commandRegistry.prepare('recipe.removeStep', { recipe: 'Khichdi', step: 2 })
    const result = await commandRegistry.execute(prepared, { idempotencyKey: 'p:4' }) as { stepCount: number }
    expect(result.stepCount).toBe(1)
    const recipe = await getRecipe(threadId)
    expect(recipe?.steps[0].text).toContain('rice')
  })
})

describe('recipe.updateProperties', () => {
  it('updates only the fields provided', async () => {
    const threadId = await seedRecipe()
    const prepared = await commandRegistry.prepare('recipe.updateProperties', { recipe: 'Khichdi', servings: 6 })
    await commandRegistry.execute(prepared, { idempotencyKey: 'p:5' })
    const recipe = await getRecipe(threadId)
    expect(recipe?.properties.get('recipe-servings')).toBe(6)
    expect(recipe?.properties.get('recipe-prep-minutes')).toBe(10)
  })
})

describe('recipe.delete', () => {
  it('removes the recipe thread and its note', async () => {
    const threadId = await seedRecipe()
    const prepared = await commandRegistry.prepare('recipe.delete', { recipe: 'Khichdi' })
    await commandRegistry.execute(prepared, { idempotencyKey: 'p:6' })
    expect(await db.threads.get(threadId)).toBeUndefined()
    expect(await db.threadNotes.get(threadId)).toBeUndefined()
    expect(await getRecipe(threadId)).toBeUndefined()
  })
})
