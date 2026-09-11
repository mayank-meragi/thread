/**
 * The recipe thread body is still ordinary Thread Markdown. This small
 * parser only adds recipe meaning to the existing outline: indentation gives
 * ownership, while an explicit #[cook-*] tag gives a block its role.
 */

export const RECIPE_CONTENT_TAGS = {
  section: 'cook-section',
  step: 'cook-step',
  note: 'cook-note',
} as const

export type RecipeContentRole = (typeof RECIPE_CONTENT_TAGS)[keyof typeof RECIPE_CONTENT_TAGS]

export interface RecipeSourceNode {
  id: string
  sourceLine: number
  rawLine: string
  indent: number
  listPrefix: string
  text: string
  role: RecipeContentRole
  explicitRole?: RecipeContentRole
  parentId: string | null
  children: RecipeSourceNode[]
}

export interface RecipeDocument {
  lines: string[]
  nodes: RecipeSourceNode[]
  roots: RecipeSourceNode[]
}

const ROLE_PATTERN = /^#\[(cook-section|cook-step|cook-note)\]\s*/
const LIST_PATTERN = /^(\s*)([-*+]|\d+\.)\s+(.*)$/

function inferredRole(node: RecipeSourceNode): RecipeContentRole {
  return node.children.length > 0 ? RECIPE_CONTENT_TAGS.section : RECIPE_CONTENT_TAGS.step
}

function roleAndText(content: string): { role: RecipeContentRole | undefined; text: string } {
  const match = content.match(ROLE_PATTERN)
  if (!match) return { role: undefined, text: content.trim() }
  return { role: match[1] as RecipeContentRole, text: content.slice(match[0].length).trim() }
}

/** Parse a recipe body without changing or normalizing its Markdown. */
export function parseRecipeDocument(markdown: string): RecipeDocument {
  const lines = markdown.split('\n')
  const nodes: RecipeSourceNode[] = []
  const roots: RecipeSourceNode[] = []
  const stack: Array<{ indent: number; node: RecipeSourceNode }> = []
  const siblingCounts = new Map<string, number>()

  lines.forEach((rawLine, sourceLine) => {
    if (!rawLine.trim()) return
    const match = rawLine.match(LIST_PATTERN)
    const indent = match?.[1].length ?? 0
    const listPrefix = match ? `${match[1]}${match[2]} ` : ''
    const content = match?.[3] ?? rawLine.trim()
    // New threads start with the editor's empty `- ` placeholder. It is not
    // recipe content and must not turn into a phantom cooking step.
    if (match && !content.trim()) return
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop()
    const parent = stack.at(-1)?.node
    const parentKey = parent?.id ?? 'root'
    const sibling = siblingCounts.get(parentKey) ?? 0
    siblingCounts.set(parentKey, sibling + 1)
    const id = parent ? `${parent.id}.${sibling}` : `${sibling}`
    const parsed = roleAndText(content)
    const node: RecipeSourceNode = {
      id,
      sourceLine,
      rawLine,
      indent,
      listPrefix,
      text: parsed.text,
      role: parsed.role ?? RECIPE_CONTENT_TAGS.step,
      explicitRole: parsed.role,
      parentId: parent?.id ?? null,
      children: [],
    }
    if (parent) parent.children.push(node)
    else roots.push(node)
    nodes.push(node)
    stack.push({ indent, node })
  })

  // Untagged legacy parents are sections by virtue of having children. This
  // lets already-created recipes keep rendering correctly while all new
  // mutations write explicit roles.
  nodes.forEach((node) => {
    if (!node.explicitRole) node.role = inferredRole(node)
  })
  return { lines, nodes, roots }
}

export function stripRecipeRole(text: string): string {
  return text.replace(ROLE_PATTERN, '').trim()
}

export function recipeRoleTag(role: RecipeContentRole): string {
  return `#[${role}]`
}

/** Format a node using its original indentation/list marker and an explicit role. */
export function formatRecipeNodeLine(node: RecipeSourceNode, role: RecipeContentRole, text: string): string {
  const prefix = node.listPrefix || `${' '.repeat(node.indent)}- `
  return `${prefix}${recipeRoleTag(role)}${text.trim() ? ` ${text.trim()}` : ''}`
}

/** Format newly-created recipe content using the canonical tagged form. */
export function formatNewRecipeLine(role: RecipeContentRole, text: string, indent = 0): string {
  return `${' '.repeat(indent)}- ${recipeRoleTag(role)}${text.trim() ? ` ${text.trim()}` : ''}`
}

export function subtreeEndLine(document: RecipeDocument, node: RecipeSourceNode): number {
  const descendants = document.nodes.filter((candidate) => {
    let parentId = candidate.parentId
    while (parentId) {
      if (parentId === node.id) return true
      parentId = document.nodes.find((item) => item.id === parentId)?.parentId ?? null
    }
    return false
  })
  return Math.max(node.sourceLine, ...descendants.map((candidate) => candidate.sourceLine))
}

export function normalizeRecipeMarkdown(markdown: string): string {
  const document = parseRecipeDocument(markdown)
  const lines = [...document.lines]
  document.nodes.forEach((node) => {
    lines[node.sourceLine] = formatRecipeNodeLine(node, node.role, node.text)
  })
  return lines.join('\n')
}
