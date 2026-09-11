import { createThread, db, deleteThread, removeThreadProperty, saveThreadNote, setBlockProperty, setThreadProperty, type PropertyValue } from '../../db'
import { createMealPlanTask, deleteTask } from '../tasks'
import { parseThreadDocument } from '../threadDocument'
import { RECIPE_MARKER_PROPERTY, getCookRole, isRecipeThread } from './selectors'
import {
  formatNewRecipeLine,
  formatRecipeNodeLine,
  normalizeRecipeMarkdown,
  parseRecipeDocument,
  subtreeEndLine,
  RECIPE_CONTENT_TAGS,
  type RecipeContentRole,
  type RecipeDocument,
  type RecipeSourceNode,
} from './recipeDocument'
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

async function currentDocument(threadId: string): Promise<RecipeDocument> {
  return parseRecipeDocument(await currentBody(threadId))
}

async function writeBody(threadId: string, body: string): Promise<void> {
  await saveThreadNote(threadId, body || '- ')
}

function textWithoutRole(text: string): string {
  return text.trim().replace(/^#\[(?:cook-section|cook-step|cook-note)\]\s*/, '').trim()
}

function insertRecipeLine(document: RecipeDocument, node: RecipeSourceNode | undefined, role: RecipeContentRole, text: string): string {
  const lines = [...document.lines]
  const content = textWithoutRole(text)
  if (!node) {
    const body = lines
      .filter((line) => !/^\s*(?:[-*+]|\d+\.)\s*$/.test(line))
      .join('\n')
      .trimEnd()
    return `${body}${body ? '\n' : ''}${formatNewRecipeLine(role, content)}`
  }
  const insertAt = subtreeEndLine(document, node) + 1
  lines.splice(insertAt, 0, formatNewRecipeLine(role, content, node.indent + 2))
  return lines.join('\n')
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
  const document = await currentDocument(recipeThreadId)
  const body = insertRecipeLine(document, undefined, RECIPE_CONTENT_TAGS.step, step)
  await writeBody(recipeThreadId, body)
  return document.nodes.filter((node) => node.role === RECIPE_CONTENT_TAGS.step).length
}

export async function addSection(recipeThreadId: string, title: string, parentId?: string): Promise<string> {
  await requireRecipe(recipeThreadId)
  const text = title.trim()
  if (!text) throw new Error('A section needs a title.')
  const document = await currentDocument(recipeThreadId)
  const parent = parentId ? document.nodes.find((node) => node.id === parentId && node.role === RECIPE_CONTENT_TAGS.section) : undefined
  if (parentId && !parent) throw new Error('This recipe section no longer exists.')
  await writeBody(recipeThreadId, insertRecipeLine(document, parent, RECIPE_CONTENT_TAGS.section, text))
  return `${document.nodes.length}`
}

export async function addStepToSection(recipeThreadId: string, sectionId: string, text: string): Promise<number> {
  await requireRecipe(recipeThreadId)
  const step = text.trim()
  if (!step) throw new Error('A step needs some text.')
  const document = await currentDocument(recipeThreadId)
  const section = document.nodes.find((node) => node.id === sectionId && node.role === RECIPE_CONTENT_TAGS.section)
  if (!section) throw new Error('This recipe section no longer exists.')
  await writeBody(recipeThreadId, insertRecipeLine(document, section, RECIPE_CONTENT_TAGS.step, step))
  return document.nodes.filter((node) => node.role === RECIPE_CONTENT_TAGS.step).length
}

export async function addNote(recipeThreadId: string, text: string, parentId?: string): Promise<void> {
  await requireRecipe(recipeThreadId)
  const note = text.trim()
  if (!note) throw new Error('A note needs some text.')
  const document = await currentDocument(recipeThreadId)
  const parent = parentId ? document.nodes.find((node) => node.id === parentId && node.role !== RECIPE_CONTENT_TAGS.note) : undefined
  if (parentId && !parent) throw new Error('The note destination no longer exists.')
  await writeBody(recipeThreadId, insertRecipeLine(document, parent, RECIPE_CONTENT_TAGS.note, note))
}

export async function updateNote(recipeThreadId: string, noteId: string, text: string): Promise<void> {
  await requireRecipe(recipeThreadId)
  const note = text.trim()
  if (!note) throw new Error('A note needs some text.')
  const document = await currentDocument(recipeThreadId)
  const target = document.nodes.find((node) => node.id === noteId && node.role === RECIPE_CONTENT_TAGS.note)
  if (!target) throw new Error('This note no longer exists.')
  const lines = [...document.lines]
  lines[target.sourceLine] = formatRecipeNodeLine(target, RECIPE_CONTENT_TAGS.note, note)
  await writeBody(recipeThreadId, lines.join('\n'))
}

export async function removeNote(recipeThreadId: string, noteId: string): Promise<void> {
  await requireRecipe(recipeThreadId)
  const document = await currentDocument(recipeThreadId)
  const target = document.nodes.find((node) => node.id === noteId && node.role === RECIPE_CONTENT_TAGS.note)
  if (!target) return
  const lines = [...document.lines]
  lines.splice(target.sourceLine, subtreeEndLine(document, target) - target.sourceLine + 1)
  await writeBody(recipeThreadId, lines.join('\n'))
}

export async function removeSection(recipeThreadId: string, sectionId: string): Promise<void> {
  await requireRecipe(recipeThreadId)
  const document = await currentDocument(recipeThreadId)
  const target = document.nodes.find((node) => node.id === sectionId && node.role === RECIPE_CONTENT_TAGS.section)
  if (!target) return
  const lines = [...document.lines]
  lines.splice(target.sourceLine, subtreeEndLine(document, target) - target.sourceLine + 1)
  await writeBody(recipeThreadId, lines.join('\n'))
}

export async function updateStep(recipeThreadId: string, index: number, text: string): Promise<void> {
  await requireRecipe(recipeThreadId)
  const step = text.trim()
  if (!step) throw new Error('A step needs some text.')
  const document = await currentDocument(recipeThreadId)
  const steps = document.nodes.filter((node) => node.role === RECIPE_CONTENT_TAGS.step)
  const target = steps[index]
  if (!target) throw new Error('This step no longer exists.')
  const lines = [...document.lines]
  lines[target.sourceLine] = formatRecipeNodeLine(target, RECIPE_CONTENT_TAGS.step, step)
  await writeBody(recipeThreadId, lines.join('\n'))
}

export async function removeStep(recipeThreadId: string, index: number): Promise<void> {
  await requireRecipe(recipeThreadId)
  const document = await currentDocument(recipeThreadId)
  const steps = document.nodes.filter((node) => node.role === RECIPE_CONTENT_TAGS.step)
  const target = steps[index]
  if (!target) return
  const lines = [...document.lines]
  lines.splice(target.sourceLine, subtreeEndLine(document, target) - target.sourceLine + 1)
  await writeBody(recipeThreadId, lines.join('\n'))
}

export async function reorderStep(recipeThreadId: string, fromIndex: number, toIndex: number): Promise<void> {
  await requireRecipe(recipeThreadId)
  const document = await currentDocument(recipeThreadId)
  const steps = document.nodes.filter((node) => node.role === RECIPE_CONTENT_TAGS.step)
  const from = steps[fromIndex]
  const to = steps[toIndex]
  if (!from || !to || fromIndex === toIndex) return
  const lines = [...document.lines]
  const end = subtreeEndLine(document, from)
  const moved = lines.splice(from.sourceLine, end - from.sourceLine + 1)
  const targetEnd = subtreeEndLine(document, to) - (from.sourceLine < to.sourceLine ? moved.length : 0)
  const targetLine = fromIndex < toIndex ? targetEnd + 1 : to.sourceLine
  const indentDelta = to.indent - from.indent
  const adjusted = indentDelta === 0 ? moved : moved.map((line) => {
    const current = line.match(/^\s*/)?.[0].length ?? 0
    return `${' '.repeat(Math.max(0, current + indentDelta))}${line.slice(current)}`
  })
  lines.splice(targetLine, 0, ...adjusted)
  await writeBody(recipeThreadId, lines.join('\n'))
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

/** Wholesale replace a recipe outline at once -- plain entries remain root steps, while tagged/list-form input preserves sections and notes. */
export async function replaceSteps(recipeThreadId: string, steps: string[]): Promise<void> {
  await requireRecipe(recipeThreadId)
  const cleaned = steps.filter((step) => step.trim())
  if (!cleaned.length) throw new Error('A recipe needs at least one step.')
  const looksLikeOutline = cleaned.some((step) => /^\s*(?:[-*+]|\d+\.)\s+/.test(step) || /#\[(?:cook-section|cook-step|cook-note)\]/.test(step))
  const source = looksLikeOutline ? cleaned.join('\n') : cleaned.map((step) => formatNewRecipeLine(RECIPE_CONTENT_TAGS.step, step.trim())).join('\n')
  await writeBody(recipeThreadId, looksLikeOutline ? normalizeRecipeMarkdown(source) : source)
}

/** Replace the recipe's Markdown outline, normalizing legacy lines to roles. */
export async function replaceRecipeMarkdown(recipeThreadId: string, markdown: string): Promise<void> {
  await requireRecipe(recipeThreadId)
  const normalized = normalizeRecipeMarkdown(markdown.trim())
  if (!normalized.trim()) throw new Error('A recipe needs some content.')
  await writeBody(recipeThreadId, normalized)
}

export async function deleteRecipeThread(recipeThreadId: string): Promise<void> {
  await requireRecipe(recipeThreadId)
  await deleteThread(recipeThreadId)
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
