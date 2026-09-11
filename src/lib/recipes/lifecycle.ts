import { db, removeBlockProperty, setBlockProperty } from '../../db'
import { isoToday } from '../dates'
import { createCookSubtask, createCookTask, setTaskStatus } from '../tasks'
import { scaleIngredient } from './cooklangTokens'
import { getActiveCookSession, getCookSession, getRecipe } from './selectors'
import type { CookSessionView, CookStepView } from './types'

export interface ActiveCookConflict {
  code: 'cook_already_active'
  activeCookTaskId: string
}

/** Thrown by {@link startCook} when a different cook session is already in progress. */
export class ActiveCookConflictError extends Error {
  constructor(readonly conflict: ActiveCookConflict) {
    super('Another cook session is already in progress.')
    this.name = 'ActiveCookConflictError'
  }
}

/** Thrown by {@link finishCook} when steps are unresolved and the caller has not chosen how to handle them. */
export class UnresolvedCookStepsError extends Error {
  constructor(readonly stepTaskIds: string[]) {
    super('This cook session still has unresolved steps.')
    this.name = 'UnresolvedCookStepsError'
  }
}

function wikiLink(title: string): string {
  const trimmed = title.trim()
  return /^\[\[.*\]\]$/.test(trimmed) ? trimmed : `[[${trimmed}]]`
}

function isUnresolved(step: CookStepView): boolean {
  return step.task.status !== 'done' && step.task.status !== 'canceled'
}

function isPending(status: string): boolean {
  return status === 'not_started' || status === 'in_progress'
}

async function requireCook(cookTaskId: string): Promise<void> {
  const task = await db.tasks.get(cookTaskId)
  if (!task) throw new Error('This cook session no longer exists.')
}

/**
 * Instantiates a `#[cook]` task tree for `recipeThreadId` in `options.day`
 * (default today), scaling every ingredient to `options.servings` (default
 * the recipe's own `recipe-servings`). Ingredients and steps become ordinary
 * checkable subtasks -- ingredient/step text is copied as-is (Cooklang tokens
 * included) so the cook is never disconnected from the recipe's own wording.
 */
export async function startCook(recipeThreadId: string, options: { day?: string; servings?: number } = {}): Promise<string> {
  const recipe = await getRecipe(recipeThreadId)
  if (!recipe) throw new Error('This recipe no longer exists.')

  const active = await getActiveCookSession()
  if (active) throw new ActiveCookConflictError({ code: 'cook_already_active', activeCookTaskId: active.task.id })

  const baseServingsValue = recipe.properties.get('recipe-servings')
  const baseServings = typeof baseServingsValue === 'number' && baseServingsValue > 0 ? baseServingsValue : 4
  const servings = options.servings ?? baseServings
  const scaleFactor = servings / baseServings

  const day = options.day ?? isoToday()
  const cookTaskId = await createCookTask({ text: wikiLink(recipe.thread.title), day })
  await setTaskStatus(cookTaskId, 'in_progress')
  await setBlockProperty(cookTaskId, 'cook-started-at', new Date().toISOString())
  await setBlockProperty(cookTaskId, 'cook-servings', servings)

  for (const ingredient of recipe.ingredients) {
    const scaled = scaleIngredient(ingredient, scaleFactor)
    const ingredientTaskId = await createCookSubtask(cookTaskId, 'cookIngredient', scaled.name)
    if (scaled.quantity !== undefined) await setBlockProperty(ingredientTaskId, 'cook-ingredient-quantity', scaled.quantity)
    if (scaled.unit) await setBlockProperty(ingredientTaskId, 'cook-ingredient-unit', scaled.unit)
  }

  for (const step of recipe.steps) {
    const stepTaskId = await createCookSubtask(cookTaskId, 'cookStep', step.text)
    if (step.durationSeconds !== undefined) await setBlockProperty(stepTaskId, 'cook-step-duration-seconds', step.durationSeconds)
  }

  return cookTaskId
}

export async function toggleCookIngredient(ingredientTaskId: string, gathered: boolean): Promise<void> {
  await setTaskStatus(ingredientTaskId, gathered ? 'done' : 'not_started')
}

/**
 * Marks a step done and returns the id of the next pending step (in document
 * order) for the UI to focus, or `undefined` when none remain after it.
 */
export async function completeCookStep(stepTaskId: string): Promise<string | undefined> {
  const task = await db.tasks.get(stepTaskId)
  if (!task?.parentTaskId) throw new Error('This step is not part of a cook session.')
  if (task.status !== 'done') await setTaskStatus(stepTaskId, 'done')

  const session = await getCookSession(task.parentTaskId)
  if (!session) return undefined
  const fromIndex = session.steps.findIndex((step) => step.task.id === stepTaskId)
  return session.steps.slice(fromIndex + 1).find((step) => isPending(step.task.status))?.task.id
}

export async function skipCookStep(stepTaskId: string): Promise<void> {
  await setTaskStatus(stepTaskId, 'canceled')
}

export interface FinishCookOptions {
  /** How to treat steps that are neither done nor skipped. Required when any exist. */
  unresolvedSteps?: 'cancel' | 'leave'
}

export async function finishCook(cookTaskId: string, options: FinishCookOptions = {}): Promise<void> {
  await requireCook(cookTaskId)
  const session = await getCookSession(cookTaskId)
  if (!session) throw new Error('This cook session no longer exists.')

  const unresolved = session.steps.filter(isUnresolved)
  if (unresolved.length > 0 && !options.unresolvedSteps) {
    throw new UnresolvedCookStepsError(unresolved.map((step) => step.task.id))
  }
  if (options.unresolvedSteps === 'cancel') {
    for (const step of unresolved) await setTaskStatus(step.task.id, 'canceled')
  }

  await setTaskStatus(cookTaskId, 'done')

  const finished = await db.blockProperties
    .where('[blockId+propertyId]')
    .equals([cookTaskId, 'cook-finished-at'])
    .first()
  if (!finished) await setBlockProperty(cookTaskId, 'cook-finished-at', new Date().toISOString())
}

export async function cancelCook(cookTaskId: string): Promise<void> {
  await requireCook(cookTaskId)
  await setTaskStatus(cookTaskId, 'canceled')
}

export async function reopenCook(cookTaskId: string): Promise<void> {
  await requireCook(cookTaskId)
  await removeBlockProperty(cookTaskId, 'cook-finished-at')
  await setTaskStatus(cookTaskId, 'in_progress')
}

export function totalStepSeconds(session: CookSessionView): number {
  return session.steps.reduce((sum, step) => sum + (step.durationSeconds ?? 0), 0)
}
