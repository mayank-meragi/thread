import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, initializeDatabase } from '../../db'
import { addStep, createRecipeThread, removeStep, reorderStep, updateRecipeProperties, updateStep } from './mutations'
import { getRecipe, isRecipeThread, listRecipes } from './selectors'

const DATE = '2026-09-01'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await initializeDatabase(DATE)
})

afterAll(() => db.close())

describe('recipe authoring mutations', () => {
  it('creates a recipe thread with a default servings marker', async () => {
    const threadId = await createRecipeThread({ title: 'Banana Bread' })
    expect(await isRecipeThread(threadId)).toBe(true)
    const recipe = await getRecipe(threadId)
    expect(recipe?.properties.get('recipe-servings')).toBe(4)
    expect(recipe?.thread.title).toBe('Banana Bread')
  })

  it('rejects mutations against a thread that is not a recipe', async () => {
    const { createThread } = await import('../../db')
    const plainThreadId = await createThread('Just Notes')
    await expect(addStep(plainThreadId, 'Do a thing')).rejects.toThrow('not a recipe')
  })

  it('adds, updates, reorders, and removes Cooklang-annotated steps', async () => {
    const threadId = await createRecipeThread({ title: 'Pancakes', servings: 2 })
    await addStep(threadId, 'Whisk @eggs{2} and @milk{300%ml} in the #mixing bowl{}.')
    await addStep(threadId, 'Add @flour{200%g} and mix with the #mixing bowl{} and #whisk.')
    await addStep(threadId, 'Cook for ~{2%minutes} per side.')

    let recipe = await getRecipe(threadId)
    expect(recipe?.steps).toHaveLength(3)
    expect(recipe?.ingredients.map((ingredient) => ingredient.name)).toEqual(['eggs', 'milk', 'flour'])
    expect(recipe?.cookware).toEqual(['mixing bowl', 'whisk'])
    expect(recipe?.steps[2].durationSeconds).toBe(120)

    await updateStep(threadId, 1, 'Add @flour{250%g} and mix until smooth.')
    recipe = await getRecipe(threadId)
    expect(recipe?.steps[1].text).toContain('250%g')
    expect(recipe?.ingredients.find((ingredient) => ingredient.name === 'flour')?.quantity).toBe(250)

    await reorderStep(threadId, 0, 2)
    recipe = await getRecipe(threadId)
    expect(recipe?.steps.map((step) => step.text)[2]).toContain('eggs')

    await removeStep(threadId, 0)
    recipe = await getRecipe(threadId)
    expect(recipe?.steps).toHaveLength(2)
  })

  it('updates recipe-level properties and clears them when set to an empty value', async () => {
    const threadId = await createRecipeThread({ title: 'Curry' })
    await updateRecipeProperties(threadId, { prepMinutes: 10, cookMinutes: 30, category: ['dinner'], cuisine: 'indian' })

    let recipe = await getRecipe(threadId)
    expect(recipe?.properties.get('recipe-prep-minutes')).toBe(10)
    expect(recipe?.properties.get('recipe-cook-minutes')).toBe(30)
    expect(recipe?.properties.get('recipe-category')).toEqual(['dinner'])
    expect(recipe?.properties.get('recipe-cuisine')).toBe('indian')

    await updateRecipeProperties(threadId, { cuisine: null })
    recipe = await getRecipe(threadId)
    expect(recipe?.properties.has('recipe-cuisine')).toBe(false)
  })

  it('lists every recipe thread in the library, sorted by title', async () => {
    await createRecipeThread({ title: 'Zucchini Bread' })
    await createRecipeThread({ title: 'Apple Pie' })
    const { createThread } = await import('../../db')
    await createThread('Just Notes')

    const recipes = await listRecipes()
    expect(recipes.map((recipe) => recipe.thread.title)).toEqual(['Apple Pie', 'Zucchini Bread'])
  })
})
