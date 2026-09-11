import { z } from 'zod'
import type { ThreadRecord } from '../../db'
import { RECIPE_CATEGORY_OPTIONS, RECIPE_CUISINE_OPTIONS } from '../blockMetadata'
import {
  addStep,
  createRecipeThread,
  deleteRecipeThread,
  removeStep,
  replaceSteps,
  updateRecipeProperties,
  updateStep,
} from '../recipes/mutations'
import { getRecipe, isRecipeThread } from '../recipes/selectors'
import { findThreadByTitle, resolveThread, threadTarget } from './resolve'
import { recipeStepsResultSchema, threadEntityResultSchema, threadMutationResultSchema } from './schemas'
import { defineCommand, type CommandDefinition, type CommandResolutionContext } from './types'

// ---------------------------------------------------------------------------
// Shared schema + helpers
// ---------------------------------------------------------------------------

const CATEGORY_IDS = RECIPE_CATEGORY_OPTIONS.map((option) => option.id)
const CUISINE_IDS = RECIPE_CUISINE_OPTIONS.map((option) => option.id)

const STEP_SYNTAX_NOTE =
  'Each step is a plain instruction in Cooklang-style annotated Markdown: mark every ingredient mention as @name{quantity%unit} '
  + '(a multi-word name needs braces even with no quantity, e.g. @brown sugar{}; a single word can omit them, e.g. @salt). '
  + 'Mark cookware as #name{} (or bare #name for a single word). Mark a timed duration as ~{quantity%unit} (e.g. ~{5%minutes}), '
  + 'or ~label{quantity%unit} to name it. Do not annotate anything that is not actually an ingredient, cookware, or a timed duration. '
  + 'Example: "Whisk @eggs{2} and @milk{300%ml} together, then cook in a #frying pan{} for ~{2%minutes}."'

const stepsInputSchema = z.array(z.string().trim().min(1)).min(1).max(40)
  .describe(`Ordered cooking steps. ${STEP_SYNTAX_NOTE}`)

const propertiesInputSchema = z.object({
  servings: z.number().positive().optional().describe('Base servings the ingredient quantities assume.'),
  prepMinutes: z.number().nonnegative().optional(),
  cookMinutes: z.number().nonnegative().optional(),
  sourceUrl: z.string().trim().min(1).optional(),
  imageUrl: z.string().trim().min(1).optional(),
  category: z.array(z.enum(CATEGORY_IDS as [string, ...string[]])).optional(),
  cuisine: z.enum(CUISINE_IDS as [string, ...string[]]).optional(),
}).strict()

type PropertiesInput = z.infer<typeof propertiesInputSchema>

// A recipe is a thread carrying the `recipe-servings` marker property (see
// `RECIPE_MARKER_PROPERTY` in selectors.ts) -- resolve it the same way any
// other thread reference resolves, then confirm the marker is set. A thread
// a same-plan earlier step will create has no database row yet (`createdAt`
// is `''`, see resolve.ts's `pendingThreadStub`) so the marker check is
// skipped for it and trusted instead.
async function resolveRecipe(reference: string, context?: CommandResolutionContext): Promise<ThreadRecord> {
  const thread = await resolveThread(reference, undefined, context)
  if (thread.createdAt && !(await isRecipeThread(thread.id))) {
    throw new Error(`"${thread.title}" is not a recipe.`)
  }
  return thread
}

async function stepCountOf(threadId: string): Promise<number> {
  const recipe = await getRecipe(threadId)
  return recipe?.steps.length ?? 0
}

// `updateRecipeProperties` treats an absent key as "leave untouched" and a
// present-but-empty value as "clear it" (see mutations.ts) -- so a field the
// caller didn't mention must be OMITTED from the object entirely, not passed
// through as `undefined`, or it would clear an existing value.
function pickProperties(input: PropertiesInput): PropertiesInput {
  const properties: PropertiesInput = {}
  if (input.servings !== undefined) properties.servings = input.servings
  if (input.prepMinutes !== undefined) properties.prepMinutes = input.prepMinutes
  if (input.cookMinutes !== undefined) properties.cookMinutes = input.cookMinutes
  if (input.sourceUrl !== undefined) properties.sourceUrl = input.sourceUrl
  if (input.imageUrl !== undefined) properties.imageUrl = input.imageUrl
  if (input.category !== undefined) properties.category = input.category
  if (input.cuisine !== undefined) properties.cuisine = input.cuisine
  return properties
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const create = defineCommand({
  name: 'recipe.create',
  summary: 'Create a new recipe: a thread whose steps use Cooklang-style @ingredient/#cookware/~timer annotations.',
  category: 'recipes',
  keywords: ['recipe', 'cook', 'cooking', 'ingredient', 'cookware', 'step', 'dish', 'meal', 'kitchen'],
  example:
    'action recipe.create as khichdi\n' +
    '  title: "Khichdi"\n' +
    '  servings: 4\n' +
    '  prepMinutes: 10\n' +
    '  cookMinutes: 25\n' +
    '  category: ["dinner"]\n' +
    '  steps:\n' +
    '    - "Rinse @rice{1%cup} and @split moong dal{1/2%cup} together."\n' +
    '    - "In a #pressure cooker{}, heat @ghee{1%tbsp} and add @cumin."\n' +
    '    - "Add the rice and dal, @water{4%cups}, and @turmeric, then cook for ~{3%whistles}."',
  risk: 'write',
  idempotency: 'receipt-required',
  inputSchema: z.object({ title: z.string().trim().min(1), steps: stepsInputSchema }).merge(propertiesInputSchema).strict(),
  outputSchema: threadEntityResultSchema,
  resolve: async (input, context) => {
    const existing = await findThreadByTitle(input.title, context)
    if (existing && existing.createdAt && await isRecipeThread(existing.id)) {
      throw new Error(`"${existing.title}" already exists as a recipe. Use recipe.addSteps, recipe.setSteps, or recipe.updateProperties instead.`)
    }
    return { input, existing }
  },
  preview: ({ input, existing }) => ({
    summary: existing ? `Use existing thread “${existing.title}” as a recipe` : `Create recipe “${input.title}” with ${input.steps.length} step(s)`,
    changes: [{
      kind: existing ? 'update' : 'create',
      target: existing ? threadTarget(existing) : { kind: 'thread', id: input.title, label: input.title },
      description: `${input.steps.length} step(s), ${input.servings ?? 4} servings`,
      after: { title: input.title, steps: input.steps },
    }],
  }),
  execute: async ({ input }) => {
    const thread = await createRecipeThread({ title: input.title, servings: input.servings })
    const properties = pickProperties(input)
    delete properties.servings // already set via createRecipeThread above
    await updateRecipeProperties(thread, properties)
    await replaceSteps(thread, input.steps)
    return { thread, created: true }
  },
})

const addSteps = defineCommand({
  name: 'recipe.addSteps',
  summary: 'Append one or more steps to the end of an existing recipe.',
  category: 'recipes',
  keywords: ['recipe', 'step', 'add', 'append', 'ingredient'],
  example: 'action recipe.addSteps\n  recipe: "Khichdi"\n  steps:\n    - "Garnish with @coriander and a squeeze of @lemon."',
  risk: 'write',
  idempotency: 'receipt-required',
  inputSchema: z.object({ recipe: z.string().trim().min(1), steps: stepsInputSchema }).strict(),
  outputSchema: recipeStepsResultSchema,
  resolve: async (input, context) => ({ input, thread: await resolveRecipe(input.recipe, context) }),
  preview: ({ input, thread }) => ({
    summary: `Add ${input.steps.length} step(s) to “${thread.title}”`,
    changes: input.steps.map((step, index) => ({
      kind: 'append' as const,
      target: threadTarget(thread),
      field: `step ${index + 1}`,
      description: step,
    })),
  }),
  execute: async ({ input, thread }) => {
    for (const step of input.steps) await addStep(thread.id, step)
    return { thread: thread.id, stepCount: await stepCountOf(thread.id) }
  },
})

const setSteps = defineCommand({
  name: 'recipe.setSteps',
  summary: 'Replace a recipe’s entire step list at once -- use for a substantial rewrite (e.g. "make it vegetarian", "scale to 6 servings"), not a small tweak.',
  category: 'recipes',
  keywords: ['recipe', 'step', 'rewrite', 'replace', 'edit', 'update'],
  example:
    'action recipe.setSteps\n' +
    '  recipe: "Khichdi"\n' +
    '  steps:\n' +
    '    - "Rinse @rice{1.5%cup} and @split moong dal{3/4%cup} together."\n' +
    '    - "..."',
  risk: 'destructive',
  idempotency: 'natural',
  inputSchema: z.object({ recipe: z.string().trim().min(1), steps: stepsInputSchema }).strict(),
  outputSchema: recipeStepsResultSchema,
  resolve: async (input, context) => {
    const thread = await resolveRecipe(input.recipe, context)
    const current = await getRecipe(thread.id)
    return { input, thread, before: current?.steps.map((step) => step.text) ?? [] }
  },
  preview: ({ input, thread, before }) => {
    const changed = JSON.stringify(before) !== JSON.stringify(input.steps)
    return {
      summary: changed ? `Replace all ${before.length} step(s) in “${thread.title}” with ${input.steps.length} new one(s)` : `Keep “${thread.title}”’s steps unchanged`,
      changes: changed ? [{
        kind: 'replace',
        target: threadTarget(thread),
        field: 'steps',
        description: `Replace ${before.length} step(s) with ${input.steps.length} step(s)`,
        before,
        after: input.steps,
      }] : [],
    }
  },
  execute: async ({ input, thread }) => {
    await replaceSteps(thread.id, input.steps)
    return { thread: thread.id, stepCount: input.steps.length }
  },
})

const updateStepCommand = defineCommand({
  name: 'recipe.updateStep',
  summary: 'Edit the text of one existing step, by its 1-based position.',
  category: 'recipes',
  keywords: ['recipe', 'step', 'edit', 'update', 'fix'],
  example: 'action recipe.updateStep\n  recipe: "Khichdi"\n  step: 2\n  text: "In a #pressure cooker{}, heat @ghee{2%tbsp} and add @cumin and @{bay leaf}."',
  risk: 'write',
  idempotency: 'natural',
  inputSchema: z.object({
    recipe: z.string().trim().min(1),
    step: z.number().int().min(1),
    text: z.string().trim().min(1).describe(STEP_SYNTAX_NOTE),
  }).strict(),
  outputSchema: threadMutationResultSchema,
  resolve: async (input, context) => {
    const thread = await resolveRecipe(input.recipe, context)
    const current = await getRecipe(thread.id)
    const before = current?.steps[input.step - 1]
    if (!before) throw new Error(`"${thread.title}" has ${current?.steps.length ?? 0} step(s); step ${input.step} does not exist.`)
    return { input, thread, before: before.text }
  },
  preview: ({ input, thread, before }) => ({
    summary: before === input.text ? `Keep step ${input.step} of “${thread.title}” unchanged` : `Update step ${input.step} of “${thread.title}”`,
    changes: before === input.text ? [] : [{
      kind: 'update',
      target: threadTarget(thread),
      field: `step ${input.step}`,
      description: `Step ${input.step}: ${before} → ${input.text}`,
      before,
      after: input.text,
    }],
  }),
  execute: async ({ input, thread, before }) => {
    const changed = before !== input.text
    if (changed) await updateStep(thread.id, input.step - 1, input.text)
    return { thread: thread.id, changed }
  },
})

const removeStepCommand = defineCommand({
  name: 'recipe.removeStep',
  summary: 'Delete one step from a recipe, by its 1-based position.',
  category: 'recipes',
  keywords: ['recipe', 'step', 'remove', 'delete', 'drop'],
  example: 'action recipe.removeStep\n  recipe: "Khichdi"\n  step: 4',
  risk: 'destructive',
  idempotency: 'natural',
  inputSchema: z.object({ recipe: z.string().trim().min(1), step: z.number().int().min(1) }).strict(),
  outputSchema: recipeStepsResultSchema,
  resolve: async (input, context) => {
    const thread = await resolveRecipe(input.recipe, context)
    const current = await getRecipe(thread.id)
    const target = current?.steps[input.step - 1]
    if (!target) throw new Error(`"${thread.title}" has ${current?.steps.length ?? 0} step(s); step ${input.step} does not exist.`)
    return { input, thread, text: target.text, stepCount: current!.steps.length }
  },
  preview: ({ input, thread, text, stepCount }) => ({
    summary: `Remove step ${input.step} from “${thread.title}”`,
    changes: [{
      kind: 'remove',
      target: threadTarget(thread),
      field: `step ${input.step}`,
      description: `Delete step ${input.step}: ${text}`,
      before: text,
    }],
    warnings: stepCount <= 1 ? ['This is the recipe’s only step.'] : undefined,
  }),
  execute: async ({ input, thread }) => {
    await removeStep(thread.id, input.step - 1)
    return { thread: thread.id, stepCount: await stepCountOf(thread.id) }
  },
})

const updateProperties = defineCommand({
  name: 'recipe.updateProperties',
  summary: 'Update a recipe’s servings, prep/cook time, category, cuisine, source URL, or image URL. Omitted fields are left unchanged.',
  category: 'recipes',
  keywords: ['recipe', 'servings', 'scale', 'category', 'cuisine', 'prep', 'cook', 'time', 'property'],
  example: 'action recipe.updateProperties\n  recipe: "Khichdi"\n  servings: 6\n  category: ["dinner"]\n  cuisine: "indian"',
  risk: 'write',
  idempotency: 'natural',
  inputSchema: z.object({ recipe: z.string().trim().min(1) }).merge(propertiesInputSchema).strict(),
  outputSchema: threadMutationResultSchema,
  resolve: async (input, context) => {
    const thread = await resolveRecipe(input.recipe, context)
    const properties = pickProperties(input)
    const fields = Object.keys(properties) as Array<keyof PropertiesInput>
    return { thread, properties, fields }
  },
  preview: ({ thread, properties, fields }) => ({
    summary: fields.length ? `Update ${fields.join(', ')} on “${thread.title}”` : `No property changes for “${thread.title}”`,
    changes: fields.map((field) => ({
      kind: 'update' as const,
      target: threadTarget(thread),
      field,
      description: `Set “${field}”`,
      after: (properties as Record<string, unknown>)[field],
    })),
  }),
  execute: async ({ thread, properties, fields }) => {
    if (fields.length) await updateRecipeProperties(thread.id, properties)
    return { thread: thread.id, changed: fields.length > 0 }
  },
})

const deleteRecipe = defineCommand({
  name: 'recipe.delete',
  summary: 'Permanently delete a recipe and its notes. Cannot be undone.',
  category: 'recipes',
  keywords: ['recipe', 'delete', 'remove', 'discard'],
  example: 'action recipe.delete\n  recipe: "Khichdi"',
  risk: 'destructive',
  idempotency: 'natural',
  inputSchema: z.object({ recipe: z.string().trim().min(1) }).strict(),
  outputSchema: threadMutationResultSchema,
  resolve: async (input, context) => ({ thread: await resolveRecipe(input.recipe, context) }),
  preview: ({ thread }) => ({
    summary: `Delete recipe “${thread.title}”`,
    changes: [{
      kind: 'remove',
      target: threadTarget(thread),
      description: `Permanently delete “${thread.title}” and its notes`,
    }],
    warnings: ['This cannot be undone.'],
  }),
  execute: async ({ thread }) => {
    await deleteRecipeThread(thread.id)
    return { thread: thread.id, changed: true }
  },
})

export const recipeCommands: readonly CommandDefinition[] = [
  create,
  addSteps,
  setSteps,
  updateStepCommand,
  removeStepCommand,
  updateProperties,
  deleteRecipe,
]
