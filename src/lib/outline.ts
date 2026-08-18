export interface ParsedMention {
  id: string
  threadId: string
  title: string
  day: string
  line: number
  excerpt: string
  kind: BlockKind
  checked: boolean
}

export type BlockKind = 'thought' | 'task' | 'question' | 'decision' | 'idea'

export interface OutlineBlock {
  id: string
  day: string
  parentId: string | null
  depth: number
  order: number
  markdown: string
  plainText: string
  kind: BlockKind
  checked: boolean
  hasChildren: boolean
}

export interface ParsedThreadOccurrence {
  id: string
  threadId: string
  title: string
  day: string
  rootBlockId: string
  order: number
}

export function slugifyThread(title: string): string {
  return title
    .trim()
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function cleanMarkdownLine(line: string): string {
  return line
    .replace(/\\(\[|\]|=|!|\?)/g, '$1')
    .replace(/^\s*(?:[-*+]\s+|\d+\.\s+)/, '')
    .replace(/^\[[ xX]\]\s*/, '')
    .replace(/^[?!=]\s+(?:\[[ xX]\]\s+)?/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[*_~`]/g, '')
    .trim()
}

export function extractThreadMentions(markdown: string, day: string): ParsedMention[] {
  const mentions: ParsedMention[] = []
  const contextStack: Array<{ indent: number; threads: Array<{ id: string; title: string }> }> = []

  markdown.split('\n').forEach((rawLine, line) => {
    if (!rawLine.trim()) return
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0
    while (contextStack.length && contextStack.at(-1)!.indent >= indent) contextStack.pop()

    const syntaxLine = rawLine.replace(/\\(\[|\]|=|!|\?)/g, '$1')
    const matches = [...syntaxLine.matchAll(/\[\[([^\]]+)\]\]/g)]
    const explicit = matches
      .map((match) => ({ title: match[1].trim(), id: slugifyThread(match[1]) }))
      .filter((thread) => thread.id)
    const inherited = contextStack.flatMap((entry) => entry.threads)
    const targets = new Map<string, { id: string; title: string }>()
    inherited.forEach((thread) => targets.set(thread.id, thread))
    explicit.forEach((thread) => targets.set(thread.id, thread))
    if (targets.size === 0) return

    const excerpt = cleanMarkdownLine(rawLine)
    const answeredQuestion = /^\s*[-*+]\s+\?\s+\[[xX]\]/.test(syntaxLine)
    const checked = /^\s*[-*+]\s+\[[xX]\]/.test(syntaxLine) || answeredQuestion
    const task = /^\s*[-*+]\s+\[[ xX]\]/.test(syntaxLine)
    const question = /^\s*[-*+]\s+\?\s+/.test(syntaxLine)
    const decision = /^\s*[-*+]\s+=\s+/.test(syntaxLine) || /\bdecision\s*:/i.test(syntaxLine)
    const idea = /^\s*[-*+]\s+!\s+/.test(syntaxLine) || /\bidea\s*:/i.test(syntaxLine)
    const kind: BlockKind = task ? 'task' : question ? 'question' : decision ? 'decision' : idea ? 'idea' : 'thought'

    Array.from(targets.values()).forEach(({ id: threadId, title }, index) => {
      mentions.push({
        id: `${day}:${line}:${index}:${threadId}`,
        threadId,
        title,
        day,
        line,
        excerpt,
        kind,
        checked,
      })
    })

    if (explicit.length) contextStack.push({ indent, threads: explicit })
  })

  return mentions
}

export function countMarkdownBlocks(markdown: string): number {
  return markdown.split('\n').filter((line) => line.trim().length > 0).length
}

export function parseOutline(markdown: string, day: string): {
  blocks: OutlineBlock[]
  occurrences: ParsedThreadOccurrence[]
} {
  const blocks: OutlineBlock[] = []
  const occurrences: ParsedThreadOccurrence[] = []
  const stack: Array<{ indent: number; id: string; path: string }> = []
  const siblingCounts = new Map<string, number>()

  markdown.split('\n').forEach((rawLine, order) => {
    if (!rawLine.trim()) return
    const item = rawLine.match(/^(\s*)(?:(?:[-*+]|\d+\.)\s+)(.*)$/)
    const indent = item?.[1].length ?? 0
    const content = item?.[2] ?? rawLine.trim()

    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop()
    const parent = stack.at(-1)
    const parentKey = parent?.id ?? 'root'
    const sibling = siblingCounts.get(parentKey) ?? 0
    siblingCounts.set(parentKey, sibling + 1)
    const path = parent ? `${parent.path}.${sibling}` : `${sibling}`
    const id = `${day}:${path}`
    const syntaxContent = content.replace(/\\(\[|\]|=|!|\?)/g, '$1')
    const answeredQuestion = /^\?\s+\[[xX]\]\s+/.test(syntaxContent)
    const checked = /^\[[xX]\]\s+/.test(syntaxContent) || answeredQuestion
    const task = /^\[[ xX]\]\s+/.test(syntaxContent)
    const question = /^\?\s+/.test(syntaxContent)
    const decision = /^=\s+/.test(syntaxContent) || /\bdecision\s*:/i.test(syntaxContent)
    const idea = /^!\s+/.test(syntaxContent) || /\bidea\s*:/i.test(syntaxContent)
    const kind: BlockKind = task ? 'task' : question ? 'question' : decision ? 'decision' : idea ? 'idea' : 'thought'

    blocks.push({
      id,
      day,
      parentId: parent?.id ?? null,
      depth: stack.length,
      order,
      markdown: content,
      plainText: cleanMarkdownLine(content),
      kind,
      checked,
      hasChildren: false,
    })

    const explicit = [...syntaxContent.matchAll(/\[\[([^\]]+)\]\]/g)]
    explicit.forEach((match, index) => {
      const title = match[1].trim()
      const threadId = slugifyThread(title)
      if (!threadId) return
      occurrences.push({
        id: `${day}:${path}:${index}:${threadId}`,
        threadId,
        title,
        day,
        rootBlockId: id,
        order,
      })
    })

    stack.push({ indent, id, path })
  })

  const parents = new Set(blocks.flatMap((block) => block.parentId ? [block.parentId] : []))
  blocks.forEach((block) => { block.hasChildren = parents.has(block.id) })
  return { blocks, occurrences }
}
