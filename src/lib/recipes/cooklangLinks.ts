// Round-trips Cooklang tokens (`@ingredient{qty%unit}(preparation)`, `^cookware{}`,
// `~{qty%unit}`) between their canonical Markdown form and a special Markdown
// link Milkdown renders and styles as a chip -- the exact technique
// `lib/wikilinks.ts` and `lib/taglinks.ts` already use for `[[wikilinks]]`
// and `#[tags]`. The original token text is preserved verbatim in the link's
// href (URL-encoded) so converting back is an exact, lossless reversal, never
// a re-parse of the display label.
import { formatQuantity, parseQuantityUnit } from './cooklangTokens'

export const INGREDIENT_TITLE = 'thread-cook-ingredient'
export const COOKWARE_TITLE = 'thread-cook-cookware'
export const TIMER_TITLE = 'thread-cook-timer'
const HREF_PREFIX = '#cooklang/'

function encodeToken(kind: 'ingredient' | 'cookware' | 'timer', raw: string): string {
  // encodeURIComponent intentionally leaves parentheses readable, but an
  // ingredient preparation uses parentheses and would otherwise confuse the
  // surrounding Markdown link syntax.
  const encoded = encodeURIComponent(raw).replace(/\(/g, '%28').replace(/\)/g, '%29')
  return `${HREF_PREFIX}${kind}/${encoded}`
}

function decodeToken(href: string): string | null {
  const match = href.match(new RegExp(`^${HREF_PREFIX}(?:ingredient|cookware|timer)/([^\\s)]+)$`))
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

function ingredientLabel(name: string, content: string, preparation?: string): string {
  const [quantity, unit] = parseQuantityUnit(content)
  const amount = [quantity !== undefined ? formatQuantity(quantity) : undefined, unit].filter(Boolean).join(' ')
  const label = amount ? `${amount} ${name}` : name
  return preparation ? `${label} (${preparation})` : label
}

function timerLabel(label: string, content: string): string {
  const [quantity, unit] = parseQuantityUnit(content)
  const amount = [quantity !== undefined ? formatQuantity(quantity) : undefined, unit].filter(Boolean).join(' ')
  return [amount, label].filter(Boolean).join(' ') || '~'
}

// A single alternated pattern matched in one pass, so a replacement's own
// output (which contains a literal `#cooklang/...` href) is never re-scanned
// by a later `.replace()` call. Thread tags still use #, while recipe cookware
// uses ^, so the two syntaxes remain unambiguous.
// Braced forms are listed before their bare-word counterpart in each group so
// the greedy braced form wins at a shared starting position.
const TOKEN_PATTERN =
  /@(?<ingName>[^{}\n@^~]+)\{(?<ingContent>[^}]*)\}(?:\((?<ingPrep>[^)\n]*)\))?|@(?<ingBare>[\p{L}\p{N}][\p{L}\p{N}'-]*)(?:\((?<ingBarePrep>[^)\n]*)\))?|~(?<timerLabel>[^{}\n@^~]*)\{(?<timerContent>[^}]*)\}|\^(?<cookName>[^{}\n@^~]+)\{(?<cookContent>[^}]*)\}|\^(?<cookBare>[\p{L}\p{N}][\p{L}\p{N}'-]*)/gu

/** Canonical Markdown (with raw `@`/`^`/`~` tokens) -> editor Markdown (tokens as chip links). */
export function cooklangLinksToEditor(markdown: string): string {
  return markdown.replace(TOKEN_PATTERN, (raw: string, ...rest: unknown[]) => {
    const groups = rest[rest.length - 1] as Record<string, string | undefined>
    if (groups.ingName !== undefined) {
      const name = groups.ingName.trim()
      if (!name) return raw
      return `[${ingredientLabel(name, groups.ingContent ?? '', groups.ingPrep?.trim() || undefined)}](${encodeToken('ingredient', raw)} "${INGREDIENT_TITLE}")`
    }
    if (groups.ingBare !== undefined) {
      return `[${ingredientLabel(groups.ingBare, '', groups.ingBarePrep?.trim() || undefined)}](${encodeToken('ingredient', raw)} "${INGREDIENT_TITLE}")`
    }
    if (groups.timerLabel !== undefined) {
      return `[${timerLabel(groups.timerLabel.trim(), groups.timerContent ?? '')}](${encodeToken('timer', raw)} "${TIMER_TITLE}")`
    }
    if (groups.cookName !== undefined) {
      const name = groups.cookName.trim()
      if (!name) return raw
      return `[${name}](${encodeToken('cookware', raw)} "${COOKWARE_TITLE}")`
    }
    if (groups.cookBare !== undefined) {
      return `[${groups.cookBare}](${encodeToken('cookware', raw)} "${COOKWARE_TITLE}")`
    }
    return raw
  })
}

/** Editor Markdown (chip links) -> canonical Markdown (raw `@`/`^`/`~` tokens), byte-exact. */
export function editorLinksToCooklang(markdown: string): string {
  return markdown.replace(
    /\[[^\]]*\]\((#cooklang\/(?:ingredient|cookware|timer)\/[^\s)]+)(?:\s+["'](?:thread-cook-ingredient|thread-cook-cookware|thread-cook-timer)["'])?\)/g,
    (whole: string, href: string) => decodeToken(href) ?? whole,
  )
}

export type CooklangSegmentKind = 'text' | 'ingredient' | 'cookware' | 'timer'
export interface CooklangSegment { kind: CooklangSegmentKind; text: string }

// Read-only counterpart to `cooklangLinksToEditor`, for rendering canonical
// Cooklang text (e.g. a recipe step) outside the Milkdown editor -- same
// single-pass token matching, but producing plain segments for a React
// component to render as chips instead of a Markdown chip-link string.
export function splitCooklangSegments(markdown: string): CooklangSegment[] {
  const segments: CooklangSegment[] = []
  let lastIndex = 0
  const pushText = (text: string) => {
    if (text) segments.push({ kind: 'text', text })
  }
  for (const match of markdown.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0
    const raw = match[0]
    const groups = match.groups as Record<string, string | undefined>
    pushText(markdown.slice(lastIndex, index))
    lastIndex = index + raw.length
    if (groups.ingName !== undefined) {
      const name = groups.ingName.trim()
      if (!name) { pushText(raw); continue }
      segments.push({ kind: 'ingredient', text: ingredientLabel(name, groups.ingContent ?? '', groups.ingPrep?.trim() || undefined) })
    } else if (groups.ingBare !== undefined) {
      segments.push({ kind: 'ingredient', text: ingredientLabel(groups.ingBare, '', groups.ingBarePrep?.trim() || undefined) })
    } else if (groups.timerLabel !== undefined) {
      segments.push({ kind: 'timer', text: timerLabel(groups.timerLabel.trim(), groups.timerContent ?? '') })
    } else if (groups.cookName !== undefined) {
      const name = groups.cookName.trim()
      if (!name) { pushText(raw); continue }
      segments.push({ kind: 'cookware', text: name })
    } else if (groups.cookBare !== undefined) {
      segments.push({ kind: 'cookware', text: groups.cookBare })
    } else {
      pushText(raw)
    }
  }
  pushText(markdown.slice(lastIndex))
  return segments
}
