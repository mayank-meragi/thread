import { createThread, db, removeThreadProperty, saveThreadNote, setBlockProperty, setThreadProperty, type PropertyValue } from '../../db'
import { createMealPlanTask, deleteTask } from '../tasks'
import { parseThreadDocument } from '../threadDocument'
import { RECIPE_MARKER_PROPERTY, getCookRole, isRecipeThread, parseRecipeSteps } from './selectors'
import type { MealType } from './types'

export interface RecipePropertyInput {
  servings?: number | null
  prepMinutes?: number | null
  cookMinutes?: number | null
  sourceUrl?: string | null
  imageUrl?: string | null
  category?: string[] | null
  cuisine?: string | null
}

const RECIPE_PROPERTY_BY_KEY: Record<keyof RecipePropertyInput, string> = {
  servings: 'recipe-servings',
  prepMinutes: 'recipe-prep-minutes',
  cookMinutes: 'recipe-cook-minutes',
  sourceUrl: 'recipe-source-url',
  imageUrl: 'recipe-image-url',
  category: 'recipe-category',
  cuisine: 'recipe-cuisine',
}

async function requireRecipe(threadId: string): Promise<void> {
  if (!(await isRecipeThread(threadId))) throw new Error('This thread is not a recipe.')
}

function wikiLink(title: string): string {
  const trimmed = title.trim()
  return /^\[\[.*\]\]$/.test(trimmed) ? trimmed : `[[${trimmed}]]`
}

async function currentBody(threadId: string): Promise<string> {
  const note = await db.threadNotes.get(threadId)
  return note ? parseThreadDocument(note.markdown).markdown : ''
}

async function writeSteps(threadId: string, steps: string[]): Promise<void> {
  const body = steps.map((step) => `- ${step}`).join('\n')
  await saveThreadNote(threadId, body || '- ')
}

export async function createRecipeThread(input: { title: string; servings?: number }): Promise<string> {
  const title = input.title.trim()
  if (!title) throw new Error('A recipe needs a name.')
  const threadId = await createThread(title)
  await setThreadProperty(threadId, RECIPE_MARKER_PROPERTY, input.servings ?? 4)
  return threadId
}

export async function addStep(recipeThreadId: string, text: string): Promise<number> {
  await requireRecipe(recipeThreadId)
  const step = text.trim()
  if (!step) throw new Error('A step needs some text.')
  const steps = parseRecipeSteps(await currentBody(recipeThreadId))
  steps.push(step)
  await writeSteps(recipeThreadId, steps)
  return steps.length - 1
}

export async function updateStep(recipeThreadId: string, index: number, text: string): Promise<void> {
  await requireRecipe(recipeThreadId)
  const step = text.trim()
  if (!step) throw new Error('A step needs some text.')
  const steps = parseRecipeSteps(await currentBody(recipeThreadId))
  if (index < 0 || index >= steps.length) throw new Error('This step no longer exists.')
  steps[index] = step
  await writeSteps(recipeThreadId, steps)
}

export async function removeStep(recipeThreadId: string, index: number): Promise<void> {
  await requireRecipe(recipeThreadId)
  const steps = parseRecipeSteps(await currentBody(recipeThreadId))
  if (index < 0 || index >= steps.length) return
  steps.splice(index, 1)
  await writeSteps(recipeThreadId, steps)
}

export async function reorderStep(recipeThreadId: string, fromIndex: number, toIndex: number): Promise<void> {
  await requireRecipe(recipeThreadId)
  const steps = parseRecipeSteps(await currentBody(recipeThreadId))
  if (fromIndex < 0 || fromIndex >= steps.length || toIndex < 0 || toIndex >= steps.length) return
  const [moved] = steps.splice(fromIndex, 1)
  steps.splice(toIndex, 0, moved)
  await writeSteps(recipeThreadId, steps)
}

export async function updateRecipeProperties(recipeThreadId: string, values: RecipePropertyInput): Promise<void> {
  await requireRecipe(recipeThreadId)
  for (const key of Object.keys(RECIPE_PROPERTY_BY_KEY) as Array<keyof RecipePropertyInput>) {
    if (!(key in values)) continue
    const propertyId = RECIPE_PROPERTY_BY_KEY[key]
    const raw = values[key]
    const isEmpty = raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0)
    if (isEmpty) {
      if (propertyId === RECIPE_MARKER_PROPERTY) continue // servings must always stay set -- it is the recipe marker
      await removeThreadProperty(recipeThreadId, propertyId)
    } else {
      await setThreadProperty(recipeThreadId, propertyId, raw as PropertyValue)
    }
  }
}

// --- Meal planning ---------------------------------------------------------

export async function planMeal(recipeThreadId: string, day: string, mealType: MealType): Promise<string> {
  await requireRecipe(recipeThreadId)
  const thread = await db.threads.get(recipeThreadId)
  if (!thread) throw new Error('This recipe no longer exists.')
  const taskId = await createMealPlanTask({ text: wikiLink(thread.title), day })
  await setBlockProperty(taskId, 'meal-plan-type', mealType)
  return taskId
}

export async function updateMealPlanType(taskId: string, mealType: MealType): Promise<void> {
  if ((await getCookRole(taskId)) !== 'mealPlan') throw new Error('This task is not a planned meal.')
  await setBlockProperty(taskId, 'meal-plan-type', mealType)
}

export async function removeMealPlan(taskId: string): Promise<void> {
  if ((await getCookRole(taskId)) !== 'mealPlan') throw new Error('This task is not a planned meal.')
  await deleteTask(taskId)
}
