import { generateObject } from 'ai'
import { z } from 'zod'
import { getAIConfig, resolveModel, resolveReasoningOptions } from '../ai'
import { articleGateway, ArticleFetchError } from '../rssArticle'
import { sanitizeFeedHtml } from '../rss'
import { RECIPE_CATEGORY_OPTIONS } from '../blockMetadata'

const MAX_ARTICLE_TEXT_CHARS = 20_000

/** Strips an already-sanitized HTML fragment down to plain, whitespace-collapsed text for the AI prompt. */
function htmlToText(html: string): string {
  if (typeof document === 'undefined') return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const template = document.createElement('template')
  template.innerHTML = sanitizeFeedHtml(html)
  return (template.content.textContent ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

const CATEGORY_IDS = RECIPE_CATEGORY_OPTIONS.map((option) => option.id)

const recipeExtractionSchema = z.object({
  title: z.string().describe('The recipe title.'),
  servings: z.number().positive().optional().describe('The number of servings the recipe yields, if stated.'),
  prepMinutes: z.number().nonnegative().optional().describe('Prep time in minutes, if stated.'),
  cookMinutes: z.number().nonnegative().optional().describe('Cook time in minutes, if stated.'),
  category: z.array(z.enum(CATEGORY_IDS as [string, ...string[]])).optional()
    .describe('Zero or more categories this recipe fits, from the given list.'),
  steps: z.array(z.string()).min(1).describe(
    'Ordered cooking steps written as plain instructions in Cooklang-style annotated Markdown. '
    + 'In every step, mark each ingredient mention as @name{quantity%unit} (a multi-word name needs the braces even with no quantity, e.g. @brown sugar{}; a single word can omit them, e.g. @salt). '
    + 'Mark cookware as #name{} (or bare #name for a single word). '
    + 'Mark a timed duration as ~{quantity%unit} (e.g. ~{5%minutes}). '
    + 'Do not annotate anything that is not actually an ingredient, cookware, or a timed duration. '
    + 'Example: "Whisk @eggs{2} and @milk{300%ml} together, then cook in a #frying pan{} for ~{2%minutes}."',
  ),
})

export interface RecipeImportDraft {
  title: string
  sourceUrl: string
  servings?: number
  prepMinutes?: number
  cookMinutes?: number
  category?: string[]
  /** One Cooklang-annotated line per step, ready to hand to `addStep` after user review. */
  steps: string[]
}

/**
 * Fetches a recipe page, extracts readable article text (Readability, same
 * gateway RSS full-article fetching uses), and asks the configured AI model
 * to structure it into a `RecipeImportDraft` with Cooklang-annotated steps.
 * Returns a draft only -- nothing is persisted here; the caller (an import UI)
 * lets the user review/edit it, then saves it through the same
 * `createRecipeThread`/`addStep`/`updateRecipeProperties` mutations manual
 * entry uses.
 */
export async function importRecipeFromUrl(url: string): Promise<RecipeImportDraft> {
  const trimmed = url.trim()
  if (!trimmed) throw new Error('Enter a recipe URL.')
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('Enter a valid URL, including https://.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Only http(s) URLs can be imported.')

  const config = getAIConfig()
  if (!config) throw new Error('Set up an AI provider in Settings before importing a recipe.')

  let article
  try {
    article = await articleGateway.fetchArticle(trimmed)
  } catch (error) {
    throw error instanceof ArticleFetchError ? new Error(error.message) : error
  }

  const text = htmlToText(article.contentHtml)
  if (!text) throw new Error('No readable content was found on this page.')

  const reasoning = resolveReasoningOptions(config)
  const { object } = await generateObject({
    model: resolveModel(config, 'recipe-import'),
    ...(reasoning ? { providerOptions: reasoning } : {}),
    schema: recipeExtractionSchema,
    prompt: `Extract a cooking recipe from this article so it can be saved into a recipe app that uses Cooklang-style inline annotations for ingredients, cookware, and timers (see the schema field descriptions for the exact syntax). Ignore surrounding site chrome, comments, ads, and unrelated content -- extract only the actual recipe (title, servings, prep/cook time, category, and step-by-step instructions).\n\nArticle title: ${article.title ?? '(unknown)'}\n\nArticle text:\n${text.slice(0, MAX_ARTICLE_TEXT_CHARS)}`,
  })

  return {
    title: object.title.trim() || article.title?.trim() || 'Imported recipe',
    sourceUrl: trimmed,
    servings: object.servings,
    prepMinutes: object.prepMinutes,
    cookMinutes: object.cookMinutes,
    category: object.category,
    steps: object.steps.map((step) => step.trim()).filter(Boolean),
  }
}
