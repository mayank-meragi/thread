// A pure, self-contained subset of the Cooklang grammar (https://cooklang.org):
// `@ingredient{quantity%unit}` and its bare single-word form `@ingredient`,
// `#cookware{}` / `#cookware` the same way, and `~{quantity%unit}` /
// `~label{quantity%unit}` timers. No dependency on Dexie or any other thread
// module -- callers (selectors, the editor decoration layer) decide what to do
// with the parsed result.

export interface RecipeIngredient {
  name: string
  quantity?: number
  unit?: string
  raw: string
}

export interface RecipeCookware {
  name: string
  raw: string
}

export interface RecipeTimerToken {
  label?: string
  quantity?: number
  unit?: string
  seconds?: number
  raw: string
}

export interface CooklangParseResult {
  ingredients: RecipeIngredient[]
  cookware: RecipeCookware[]
  timers: RecipeTimerToken[]
  /** Convenience: the first timer's duration in seconds, if any. */
  durationSeconds?: number
}

const SECONDS_PER_UNIT: Record<string, number> = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
}

/** `"200%g"` -> `[200, "g"]`, `"1/2%cup"` -> `[0.5, "cup"]`, `"2"` -> `[2, undefined]`, `""` -> `[undefined, undefined]`. */
export function parseQuantityUnit(content: string): [number | undefined, string | undefined] {
  const trimmed = content.trim()
  if (!trimmed) return [undefined, undefined]
  const [rawQuantity, rawUnit] = trimmed.split('%').map((part) => part.trim())
  return [parseQuantity(rawQuantity), rawUnit || undefined]
}

function parseQuantity(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const fraction = raw.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (fraction) {
    const denominator = Number(fraction[2])
    return denominator ? Number(fraction[1]) / denominator : undefined
  }
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function secondsFor(quantity: number | undefined, unit: string | undefined): number | undefined {
  if (quantity === undefined) return undefined
  const perUnit = unit ? SECONDS_PER_UNIT[unit.toLocaleLowerCase()] : undefined
  return perUnit !== undefined ? quantity * perUnit : undefined
}

interface Span { start: number; end: number }

function overlaps(span: Span, spans: Span[]): boolean {
  return spans.some((existing) => span.start < existing.end && span.end > existing.start)
}

/** Braced form: `SYMBOL name{content}`, name may be empty (timers) or contain spaces (multi-word ingredients/cookware). */
function bracedMatches(text: string, symbol: '@' | '#' | '~'): Array<{ name: string; content: string; raw: string; span: Span }> {
  const pattern = new RegExp(`${symbol}([^{}\\n@#~]*?)\\{([^}]*)\\}`, 'g')
  return Array.from(text.matchAll(pattern), (match) => ({
    name: match[1].trim(),
    content: match[2],
    raw: match[0],
    span: { start: match.index ?? 0, end: (match.index ?? 0) + match[0].length },
  }))
}

/** Bare single-word form: `SYMBOL word`, not immediately followed by `{` (that belongs to the braced form). */
function bareMatches(text: string, symbol: '@' | '#'): Array<{ name: string; raw: string; span: Span }> {
  const pattern = new RegExp(`${symbol}([\\p{L}\\p{N}][\\p{L}\\p{N}'-]*)`, 'gu')
  return Array.from(text.matchAll(pattern), (match) => {
    const start = match.index ?? 0
    const end = start + match[0].length
    return { name: match[1], raw: match[0], span: { start, end } }
  }).filter((entry) => text[entry.span.end] !== '{')
}

export function parseCooklangTokens(text: string): CooklangParseResult {
  const consumed: Span[] = []

  const ingredientBraced = bracedMatches(text, '@').filter((entry) => entry.name.length > 0)
  ingredientBraced.forEach((entry) => consumed.push(entry.span))
  const ingredientBare = bareMatches(text, '@').filter((entry) => !overlaps(entry.span, consumed))
  ingredientBare.forEach((entry) => consumed.push(entry.span))

  const cookwareBraced = bracedMatches(text, '#').filter((entry) => entry.name.length > 0 && !overlaps(entry.span, consumed))
  cookwareBraced.forEach((entry) => consumed.push(entry.span))
  const cookwareBare = bareMatches(text, '#').filter((entry) => !overlaps(entry.span, consumed))
  cookwareBare.forEach((entry) => consumed.push(entry.span))

  const timerBraced = bracedMatches(text, '~').filter((entry) => !overlaps(entry.span, consumed))

  const ingredients: RecipeIngredient[] = [
    ...ingredientBraced.map((entry) => {
      const [quantity, unit] = parseQuantityUnit(entry.content)
      return { name: entry.name, quantity, unit, raw: entry.raw }
    }),
    ...ingredientBare.map((entry) => ({ name: entry.name, raw: entry.raw })),
  ]

  const cookware: RecipeCookware[] = [
    ...cookwareBraced.map((entry) => ({ name: entry.name, raw: entry.raw })),
    ...cookwareBare.map((entry) => ({ name: entry.name, raw: entry.raw })),
  ]

  const timers: RecipeTimerToken[] = timerBraced.map((entry) => {
    const [quantity, unit] = parseQuantityUnit(entry.content)
    return { label: entry.name || undefined, quantity, unit, seconds: secondsFor(quantity, unit), raw: entry.raw }
  })

  return {
    ingredients,
    cookware,
    timers,
    durationSeconds: timers.find((timer) => timer.seconds !== undefined)?.seconds,
  }
}

/** Deduplicates ingredients by name (case-insensitive), summing quantities that share a unit. Order follows first appearance. */
export function mergeIngredients(ingredients: readonly RecipeIngredient[]): RecipeIngredient[] {
  const byKey = new Map<string, RecipeIngredient>()
  for (const ingredient of ingredients) {
    const key = ingredient.name.toLocaleLowerCase()
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { ...ingredient })
      continue
    }
    if (existing.quantity !== undefined && ingredient.quantity !== undefined && existing.unit === ingredient.unit) {
      existing.quantity += ingredient.quantity
    } else if (existing.quantity === undefined && ingredient.quantity !== undefined) {
      existing.quantity = ingredient.quantity
      existing.unit = ingredient.unit
    }
  }
  return Array.from(byKey.values())
}

/** Scales an ingredient's quantity by a servings ratio; leaves quantity-less ingredients untouched. */
export function scaleIngredient(ingredient: RecipeIngredient, scaleFactor: number): RecipeIngredient {
  return ingredient.quantity === undefined ? ingredient : { ...ingredient, quantity: ingredient.quantity * scaleFactor }
}

/** `2` -> `"2"`, `2.5` -> `"2.5"`, `2.3333` -> `"2.33"` (trailing zeros trimmed). */
export function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}
