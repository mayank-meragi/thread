// The single canonical description of every block kind Thread understands.
// Everything that needs to know about a kind -- the slash-command menu, the
// editor's prefix-hiding decoration, <li> styling, block conversion, and
// markdown-side detection -- reads from this list instead of keeping its own
// hardcoded copy. Adding a new prefix-based kind (one with no extra fields
// beyond its text prefix) means adding one entry here and nothing else.
//
// Task is the one structurally special case: it's represented as a
// ProseMirror node attribute (and `[ ]`/`[x]` markdown syntax) rather than a
// text prefix, so it has no prefixPattern/className here and is handled by
// its own `isTask` branch wherever this list is consumed.
export type BlockConversionKind = 'bullet' | 'task' | 'checklist' | 'idea' | 'question' | 'decision'

// Matches `()`, `( )`, `(x)`, or `(X)` at the start of a block's text --
// a plain checkbox that (unlike task) carries no due-date/priority metadata
// and never counts toward task lists, since it's a text prefix rather than
// the schema-level `checked` attribute. Shared by the prefix-kind detection
// below and by the click-to-toggle handler in MarkdownEditor.
export const checklistPrefixPattern = /^\((?:\s|x|X)?\)\s+/
export const checklistCheckedPattern = /^\((?:x|X)\)/

export interface BlockKindDefinition {
  id: BlockConversionKind
  label: string
  description: string
  glyph: string
  aliases: string[]
  /** CSS class applied to the <li> when this kind is active. */
  className?: string
  /** Matches the block's leading text once list-marker/checkbox syntax is stripped. Shared by the editor's live-DOM detection and outline.ts's markdown-side parsing so the two can't disagree about what counts as this kind. */
  prefixPattern?: RegExp
  /** Literal text inserted when converting a block to this kind. */
  prefixText?: string
  /** True only for the kind backed by the schema-level `checked` attribute. */
  isTask?: boolean
}

export const blockKindDefinitions: BlockKindDefinition[] = [
  { id: 'task', label: 'Task', description: 'Track something to do', glyph: '☐', aliases: ['todo', 'check'], isTask: true },
  { id: 'checklist', label: 'Checkbox', description: 'A plain check, not tracked as a task', glyph: '○', aliases: ['checkbox'], className: 'kind-checklist', prefixPattern: checklistPrefixPattern, prefixText: '() ' },
  { id: 'idea', label: 'Idea', description: 'Capture a possibility', glyph: '✦', aliases: ['thought'], className: 'kind-idea', prefixPattern: /^!\s+/, prefixText: '! ' },
  { id: 'question', label: 'Question', description: 'Keep an open question', glyph: '?', aliases: ['ask'], className: 'kind-question', prefixPattern: /^\?\s+/, prefixText: '? ' },
  { id: 'decision', label: 'Decision', description: 'Record a choice', glyph: '◆', aliases: ['decide'], className: 'kind-decision', prefixPattern: /^(?:=|\\=)\s+/, prefixText: '= ' },
  { id: 'bullet', label: 'Bullet', description: 'Return to a plain block', glyph: '•', aliases: ['text', 'note'] },
]

export function getBlockKindDefinition(id: BlockConversionKind): BlockKindDefinition | undefined {
  return blockKindDefinitions.find((definition) => definition.id === id)
}

// Kinds detectable purely from a text prefix -- i.e. every kind except task
// (schema attribute) and bullet (no marker at all).
export const prefixedBlockKinds: Array<BlockKindDefinition & { prefixPattern: RegExp; className: string }> =
  blockKindDefinitions.filter(
    (definition): definition is BlockKindDefinition & { prefixPattern: RegExp; className: string } =>
      Boolean(definition.prefixPattern && definition.className),
  )

export function detectPrefixKind(text: string): (BlockKindDefinition & { prefixPattern: RegExp; className: string }) | undefined {
  return prefixedBlockKinds.find((definition) => definition.prefixPattern.test(text))
}

// One combined regex matching any registered prefix, used by the editor to
// hide the raw prefix characters while typing and to size backspace deletes.
export const semanticPrefixRegex = new RegExp(
  `^(?:${prefixedBlockKinds.map((definition) => definition.prefixPattern.source.replace(/^\^/, '')).join('|')})`,
)
