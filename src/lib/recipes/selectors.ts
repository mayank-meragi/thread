import { db, type BlockPropertyRecord, type BlockTagRecord, type PropertyValue, type ThreadOccurrenceRecord } from '../../db'
import { parseThreadDocument } from '../threadDocument'
import { mergeIngredients, mergeShoppingIngredients, parseCooklangTokens, type RecipeIngredient } from './cooklangTokens'
import { parseRecipeDocument, RECIPE_CONTENT_TAGS, type RecipeSourceNode } from './recipeDocument'
import { cookRoleFromTagIds, type CookRole } from './systemTags'
import type { CookSessionView, MealPlanView, MealType, RecipeNoteView, RecipeSectionView, RecipeStepView, RecipeView } from './types'

/** The property every recipe thread carries, used to tell a recipe thread apart from any other thread. */
export const RECIPE_MARKER_PROPERTY = 'recipe-servings'

/** Splits a thread body into steps: one per non-blank line, stripping a leading `-`/`*`/`1.` list marker. */
export function parseRecipeSteps(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').trim())
    .filter((line) => line.length > 0)
}

function mergeCookware(cookware: readonly string[]): string[] {
  const seen = new Set<string>()
  return cookware.filter((item) => {
    const key = item.toLocaleLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function nearestAncestor(node: RecipeSourceNode, nodesById: ReadonlyMap<string, RecipeSourceNode>, role: RecipeSourceNode['role']): RecipeSourceNode | undefined {
  let parentId = node.parentId
  while (parentId) {
    const parent = nodesById.get(parentId)
    if (!parent) return undefined
    if (parent.role === role) return parent
    parentId = parent.parentId
  }
  return undefined
}

interface RecipeContentViews {
  sections: RecipeSectionView[]
  unsectionedSteps: RecipeStepView[]
  unsectionedNotes: RecipeNoteView[]
  steps: RecipeStepView[]
  ingredients: RecipeIngredient[]
  cookware: string[]
}

function buildRecipeContentViews(markdown: string): RecipeContentViews {
  const document = parseRecipeDocument(markdown)
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
  const sectionViews = new Map<string, RecipeSectionView>()

  for (const node of document.nodes.filter((candidate) => candidate.role === RECIPE_CONTENT_TAGS.section)) {
    const parent = nearestAncestor(node, nodesById, RECIPE_CONTENT_TAGS.section)
    sectionViews.set(node.id, {
      id: node.id,
      title: node.text || 'Untitled section',
      depth: node.indent,
      parentSectionId: parent?.id,
      children: [],
      steps: [],
      notes: [],
      ingredients: [],
      cookware: [],
    })
  }

  const steps: RecipeStepView[] = []
  const stepViews = new Map<string, RecipeStepView>()
  for (const node of document.nodes.filter((candidate) => candidate.role === RECIPE_CONTENT_TAGS.step)) {
    const parsed = parseCooklangTokens(node.text)
    const section = nearestAncestor(node, nodesById, RECIPE_CONTENT_TAGS.section)
    const step: RecipeStepView = {
      id: node.id,
      index: steps.length,
      text: node.text,
      sectionId: section?.id,
      sectionTitle: section?.text,
      sourceLine: node.sourceLine,
      depth: node.indent,
      ingredients: parsed.ingredients,
      cookware: parsed.cookware.map((item) => item.name),
      durationSeconds: parsed.durationSeconds,
      notes: [],
    }
    steps.push(step)
    stepViews.set(node.id, step)
    if (section) sectionViews.get(section.id)?.steps.push(step)
  }

  const unsectionedNotes: RecipeNoteView[] = []
  for (const node of document.nodes.filter((candidate) => candidate.role === RECIPE_CONTENT_TAGS.note)) {
    const section = nearestAncestor(node, nodesById, RECIPE_CONTENT_TAGS.section)
    const step = nearestAncestor(node, nodesById, RECIPE_CONTENT_TAGS.step)
    const note: RecipeNoteView = {
      id: node.id,
      text: node.text,
      sourceLine: node.sourceLine,
      depth: node.indent,
      sectionId: section?.id,
      parentStepId: step?.id,
    }
    if (step) stepViews.get(step.id)?.notes.push(note)
    else if (section) sectionViews.get(section.id)?.notes.push(note)
    else unsectionedNotes.push(note)
  }

  for (const section of sectionViews.values()) {
    section.ingredients = mergeIngredients(section.steps.flatMap((step) => step.ingredients))
    section.cookware = mergeCookware(section.steps.flatMap((step) => step.cookware))
    if (section.parentSectionId) sectionViews.get(section.parentSectionId)?.children.push(section)
  }

  const rootSections = [...sectionViews.values()].filter((section) => !section.parentSectionId)
  const unsectionedSteps = steps.filter((step) => !step.sectionId)
  return {
    sections: rootSections,
    unsectionedSteps,
    unsectionedNotes,
    steps,
    ingredients: mergeIngredients(steps.flatMap((step) => step.ingredients)),
    cookware: mergeCookware(steps.flatMap((step) => step.cookware)),
  }
}

async function propertyMap(threadId: string): Promise<Map<string, PropertyValue>> {
  const rows = await db.threadProperties.where('threadId').equals(threadId).toArray()
  return new Map(rows.map((row) => [row.propertyId, row.value]))
}

export async function getRecipe(threadId: string): Promise<RecipeView | undefined> {
  const thread = await db.threads.get(threadId)
  if (!thread) return undefined
  const note = await db.threadNotes.get(threadId)
  const body = note ? parseThreadDocument(note.markdown).markdown : ''
  const content = buildRecipeContentViews(body)
  return {
    thread: { id: thread.id, title: thread.title },
    properties: await propertyMap(threadId),
    ...content,
  }
}

/** Every thread carrying the recipe marker property, i.e. the full recipe library. */
export async function listRecipes(): Promise<RecipeView[]> {
  const markerRows = await db.threadProperties.where('propertyId').equals(RECIPE_MARKER_PROPERTY).toArray()
  const recipes = await Promise.all(markerRows.map((row) => getRecipe(row.threadId)))
  return recipes
    .filter((recipe): recipe is RecipeView => Boolean(recipe))
    .sort((a, b) => a.thread.title.localeCompare(b.thread.title))
}

export async function isRecipeThread(threadId: string): Promise<boolean> {
  const marker = await db.threadProperties.where('[threadId+propertyId]').equals([threadId, RECIPE_MARKER_PROPERTY]).first()
  return Boolean(marker)
}

// --- Cook sessions -----------------------------------------------------------
// A cook session is a `#[cook]` daily task tree instantiated from a recipe
// thread (see lifecycle.ts's `startCook`), directly analogous to how a
// `#[workout]` task tree relates to `lib/workouts/selectors.ts`. Unlike a
// workout, a cook session is flat: ingredients and steps are both direct
// children of the `#[cook]` root, so no ancestor-walking is needed.

interface DayCookSnapshot {
  tasks: import('../../db').TaskRecord[]
  tags: BlockTagRecord[]
  properties: BlockPropertyRecord[]
  occurrences: ThreadOccurrenceRecord[]
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const id = key(row)
    grouped.set(id, [...(grouped.get(id) ?? []), row])
  }
  return grouped
}

function blockPropertyMap(rows: BlockPropertyRecord[]): Map<string, PropertyValue> {
  return new Map(rows.map((row) => [row.propertyId, row.value]))
}

async function loadDayCookSnapshot(day: string): Promise<DayCookSnapshot> {
  const [tasks, tags, properties, occurrences] = await Promise.all([
    db.tasks.where('day').equals(day).sortBy('order'),
    db.blockTags.where('day').equals(day).toArray(),
    db.blockProperties.where('day').equals(day).toArray(),
    db.occurrences.where('day').equals(day).toArray(),
  ])
  return { tasks, tags, properties, occurrences }
}

function buildCookSession(snapshot: DayCookSnapshot, cookTaskId: string): CookSessionView | undefined {
  const taskById = new Map(snapshot.tasks.map((task) => [task.id, task]))
  const tagsByBlock = groupBy(snapshot.tags, (row) => row.blockId)
  const propertiesByBlock = groupBy(snapshot.properties, (row) => row.blockId)
  const occurrencesByBlock = groupBy(snapshot.occurrences, (row) => row.rootBlockId)
  const roleOf = (taskId: string): CookRole | undefined => cookRoleFromTagIds((tagsByBlock.get(taskId) ?? []).map((row) => row.tagId))

  const cook = taskById.get(cookTaskId)
  if (!cook || roleOf(cook.id) !== 'cook') return undefined

  const children = snapshot.tasks.filter((task) => task.parentTaskId === cook.id)
  const ingredients = children
    .filter((task) => roleOf(task.id) === 'cookIngredient')
    .map((task) => {
      const properties = blockPropertyMap(propertiesByBlock.get(task.id) ?? [])
      const quantity = properties.get('cook-ingredient-quantity')
      const unit = properties.get('cook-ingredient-unit')
      return { task, quantity: typeof quantity === 'number' ? quantity : undefined, unit: typeof unit === 'string' ? unit : undefined }
    })
  const steps = children
    .filter((task) => roleOf(task.id) === 'cookStep')
    .map((task) => {
      const properties = blockPropertyMap(propertiesByBlock.get(task.id) ?? [])
      const duration = properties.get('cook-step-duration-seconds')
      const sectionTitle = properties.get('cook-step-section')
      return {
        task,
        durationSeconds: typeof duration === 'number' ? duration : undefined,
        sectionTitle: typeof sectionTitle === 'string' ? sectionTitle : undefined,
      }
    })

  const occurrence = occurrencesByBlock.get(cook.id)?.[0]
  return {
    task: cook,
    recipeThreadId: occurrence?.threadId,
    recipeTitle: occurrence?.title,
    properties: blockPropertyMap(propertiesByBlock.get(cook.id) ?? []),
    ingredients,
    steps,
  }
}

export async function getCookRole(taskId: string): Promise<CookRole | undefined> {
  const tags = await db.blockTags.where('blockId').equals(taskId).toArray()
  return cookRoleFromTagIds(tags.map((tag) => tag.tagId))
}

export async function getCookSession(cookTaskId: string): Promise<CookSessionView | undefined> {
  const task = await db.tasks.get(cookTaskId)
  if (!task) return undefined
  return buildCookSession(await loadDayCookSnapshot(task.day), cookTaskId)
}

/** The cook task that `taskId` belongs to -- itself, or its parent when `taskId` is an ingredient/step. */
export async function getCookSessionForTask(taskId: string): Promise<CookSessionView | undefined> {
  const task = await db.tasks.get(taskId)
  if (!task) return undefined
  const snapshot = await loadDayCookSnapshot(task.day)
  const tagsByBlock = groupBy(snapshot.tags, (row) => row.blockId)
  const role = cookRoleFromTagIds((tagsByBlock.get(taskId) ?? []).map((row) => row.tagId))
  const cookTaskId = role === 'cook' ? taskId : task.parentTaskId
  return cookTaskId ? buildCookSession(snapshot, cookTaskId) : undefined
}

export async function getActiveCookSession(day?: string): Promise<CookSessionView | undefined> {
  const tasks = day ? await db.tasks.where('day').equals(day).sortBy('order') : await db.tasks.where('status').equals('in_progress').toArray()
  for (const task of tasks) {
    if (task.status === 'in_progress' && await getCookRole(task.id) === 'cook') return getCookSession(task.id)
  }
  return undefined
}

// --- Meal plans ----------------------------------------------------------
// A `#[meal-plan]` task is a lighter placeholder than a cook session: it has
// no sub-steps, just a wikilink to a recipe thread and a `meal-plan-type`
// property. Built the same "resolve role from tags, read properties, follow
// the wikilink occurrence" way as a cook session, just without the
// children-walking step.

const MEAL_TYPES: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack']

function isMealType(value: PropertyValue | undefined): value is MealType {
  return typeof value === 'string' && (MEAL_TYPES as readonly string[]).includes(value)
}

export async function getMealPlanForDay(day: string): Promise<MealPlanView[]> {
  const snapshot = await loadDayCookSnapshot(day)
  const tagsByBlock = groupBy(snapshot.tags, (row) => row.blockId)
  const propertiesByBlock = groupBy(snapshot.properties, (row) => row.blockId)
  const occurrencesByBlock = groupBy(snapshot.occurrences, (row) => row.rootBlockId)
  const roleOf = (taskId: string): CookRole | undefined => cookRoleFromTagIds((tagsByBlock.get(taskId) ?? []).map((row) => row.tagId))

  return snapshot.tasks
    .filter((task) => roleOf(task.id) === 'mealPlan')
    .map((task) => {
      const mealType = blockPropertyMap(propertiesByBlock.get(task.id) ?? []).get('meal-plan-type')
      const occurrence = occurrencesByBlock.get(task.id)?.[0]
      return {
        task,
        day,
        mealType: isMealType(mealType) ? mealType : undefined,
        recipeThreadId: occurrence?.threadId,
        recipeTitle: occurrence?.title,
      }
    })
    .sort((a, b) => MEAL_TYPES.indexOf(a.mealType ?? 'snack') - MEAL_TYPES.indexOf(b.mealType ?? 'snack') || a.task.order - b.task.order)
}

/** Every planned meal across `[startDay, endDay]` (inclusive), oldest day first. */
export async function getMealPlanRange(startDay: string, endDay: string): Promise<MealPlanView[]> {
  const days = await db.days.where('date').between(startDay, endDay, true, true).sortBy('date')
  const results: MealPlanView[] = []
  for (const day of days) results.push(...await getMealPlanForDay(day.date))
  return results
}

export interface ShoppingListEntry extends RecipeIngredient {
  /** How many planned meals in range contributed to this ingredient. */
  plannedCount: number
}

/**
 * Aggregates every ingredient across every recipe planned in `[startDay, endDay]`,
 * scaled by each recipe's own base servings (no per-meal-plan servings override
 * yet -- see the recipe tracker plan's deferred scope), deduped by name.
 */
export async function getShoppingList(startDay: string, endDay: string): Promise<ShoppingListEntry[]> {
  const plans = await getMealPlanRange(startDay, endDay)
  const recipeIds = Array.from(new Set(plans.map((plan) => plan.recipeThreadId).filter((id): id is string => Boolean(id))))
  const recipes = new Map((await Promise.all(recipeIds.map((id) => getRecipe(id)))).filter((recipe): recipe is RecipeView => Boolean(recipe)).map((recipe) => [recipe.thread.id, recipe]))

  const counted = new Map<string, ShoppingListEntry>()
  for (const plan of plans) {
    const recipe = plan.recipeThreadId ? recipes.get(plan.recipeThreadId) : undefined
    if (!recipe) continue
    for (const ingredient of recipe.ingredients) {
      const key = ingredient.name.toLocaleLowerCase()
      const existing = counted.get(key)
      const merged = existing ? mergeShoppingIngredients([existing, ingredient])[0] : { ...ingredient }
      counted.set(key, { ...merged, plannedCount: (existing?.plannedCount ?? 0) + 1 })
    }
  }
  return Array.from(counted.values())
}
