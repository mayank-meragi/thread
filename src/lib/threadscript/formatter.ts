import type { ActionNode, MapValueNode, ThreadScriptAst, ValueNode } from './types'

function quote(value: string): string {
  return JSON.stringify(value)
}

function formatScalar(value: ValueNode): string {
  if (value.kind === 'string') return value.multiline || value.value.includes('\n') ? '"""' : quote(value.value)
  if (value.kind === 'symbol') return value.value
  if (value.kind === 'number') return String(value.value)
  if (value.kind === 'boolean') return String(value.value)
  if (value.kind === 'null') return 'null'
  if (value.kind === 'reference') return `$${value.alias}.${value.path.join('.')}`
  throw new Error('Expected a scalar ThreadScript value.')
}

function formatMap(map: MapValueNode, indent: number): string[] {
  const prefix = ' '.repeat(indent)
  const lines: string[] = []
  for (const entry of map.entries) {
    const value = entry.value
    if (value.kind === 'map') {
      lines.push(`${prefix}${entry.key}:`)
      lines.push(...formatMap(value, indent + 2))
    } else if (value.kind === 'list') {
      lines.push(`${prefix}${entry.key}:`)
      lines.push(...formatList(value.items, indent + 2))
    } else if (value.kind === 'string' && (value.multiline || value.value.includes('\n'))) {
      lines.push(`${prefix}${entry.key}: """`)
      const contentPrefix = ' '.repeat(indent + 2)
      lines.push(...value.value.split('\n').map((line) => `${contentPrefix}${line}`))
      lines.push(`${prefix}"""`)
    } else {
      lines.push(`${prefix}${entry.key}: ${formatScalar(value)}`)
    }
  }
  return lines
}

function formatList(items: ValueNode[], indent: number): string[] {
  const prefix = ' '.repeat(indent)
  const lines: string[] = []
  for (const item of items) {
    if (item.kind === 'map') {
      const [first, ...rest] = item.entries
      if (!first) continue
      if (first.value.kind === 'map') {
        lines.push(`${prefix}- ${first.key}:`)
        lines.push(...formatMap(first.value, indent + 4))
        lines.push(...formatMap({ ...item, entries: rest }, indent + 2))
      } else if (first.value.kind === 'list') {
        lines.push(`${prefix}- ${first.key}:`)
        lines.push(...formatList(first.value.items, indent + 4))
        lines.push(...formatMap({ ...item, entries: rest }, indent + 2))
      } else if (first.value.kind === 'string' && (first.value.multiline || first.value.value.includes('\n'))) {
        lines.push(`${prefix}- ${first.key}: """`)
        const contentPrefix = ' '.repeat(indent + 4)
        lines.push(...first.value.value.split('\n').map((line) => `${contentPrefix}${line}`))
        lines.push(`${' '.repeat(indent + 2)}"""`)
        lines.push(...formatMap({ ...item, entries: rest }, indent + 2))
      } else {
        lines.push(`${prefix}- ${first.key}: ${formatScalar(first.value)}`)
        lines.push(...formatMap({ ...item, entries: rest }, indent + 2))
      }
    } else {
      lines.push(`${prefix}- ${formatScalar(item)}`)
    }
  }
  return lines
}

function formatAction(action: ActionNode): string[] {
  return [
    `action ${action.capability}${action.alias ? ` as ${action.alias}` : ''}`,
    ...formatMap(action.arguments, 2),
  ]
}

export function formatThreadScript(ast: ThreadScriptAst): string {
  const sections: string[][] = []
  if (ast.description !== undefined) sections.push([`plan ${quote(ast.description)}`])
  sections.push(...ast.actions.map(formatAction))
  return `${sections.map((section) => section.join('\n')).join('\n\n')}\n`
}
