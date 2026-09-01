import { z } from 'zod'
import { commandRegistry, type CommandMetadata, type CommandRegistry } from '../commands'

export interface ThreadScriptCatalogCategory {
  category: string
  commands: Array<Pick<CommandMetadata, 'name' | 'summary' | 'risk'>>
}

export interface ThreadScriptCommandHelp extends CommandMetadata {
  inputSchema: unknown
  outputSchema: unknown
}

export interface ThreadScriptHelp {
  languageVersion: 1
  overview: string
  syntax: string
  availableCommandCount: number
  categories: ThreadScriptCatalogCategory[]
  commands: ThreadScriptCommandHelp[]
}

const SYNTAX = `plan "Optional description"

action namespace.command as optionalAlias
  argument: "value"
  nested:
    key: value

Use $alias.field to reference an earlier action result. Existing TQL may only appear in command arguments explicitly documented as query selectors.`

function terms(value: string): string[] {
  return value.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? []
}

function score(topic: string, command: CommandMetadata): number {
  if (!topic.trim()) return 1
  const normalized = topic.trim().toLocaleLowerCase()
  const tokens = terms(normalized)
  const name = command.name.toLocaleLowerCase()
  const category = command.category.toLocaleLowerCase()
  const summary = command.summary.toLocaleLowerCase()
  const keywords = command.keywords.map((keyword) => keyword.toLocaleLowerCase())
  let result = name === normalized ? 100 : 0
  if (name.includes(normalized)) result += 30
  if (category === normalized || category.startsWith(normalized) || normalized.startsWith(category)) result += 24
  for (const token of tokens) {
    if (name.includes(token)) result += 10
    if (category.includes(token)) result += 7
    if (keywords.some((keyword) => keyword.includes(token) || token.includes(keyword))) result += 6
    if (summary.includes(token)) result += 2
  }
  return result
}

export function getThreadScriptCatalog(registry: CommandRegistry = commandRegistry): ThreadScriptCatalogCategory[] {
  const grouped = new Map<string, ThreadScriptCatalogCategory['commands']>()
  for (const command of registry.list()) {
    const commands = grouped.get(command.category) ?? []
    commands.push({ name: command.name, summary: command.summary, risk: command.risk })
    grouped.set(command.category, commands)
  }
  return Array.from(grouped, ([category, commands]) => ({ category, commands })).sort((a, b) => a.category.localeCompare(b.category))
}

export function getThreadScriptHelp(topic = '', options?: { limit?: number; registry?: CommandRegistry }): ThreadScriptHelp {
  const registry = options?.registry ?? commandRegistry
  const limit = Math.max(1, Math.min(options?.limit ?? 6, 10))
  const ranked = registry.list()
    .map((metadata) => ({ metadata, score: score(topic, metadata) }))
    .filter((item) => !topic.trim() || item.score > 0)
    .sort((a, b) => b.score - a.score || a.metadata.name.localeCompare(b.metadata.name))
    .slice(0, limit)
  return {
    languageVersion: 1,
    overview: 'ThreadScript describes one-shot application actions. Scripts are validated and previewed, but only trusted user confirmation may execute them.',
    syntax: SYNTAX,
    availableCommandCount: registry.list().length,
    categories: getThreadScriptCatalog(registry),
    commands: ranked.map(({ metadata }) => {
      const command = registry.require(metadata.name)
      return {
        ...metadata,
        inputSchema: z.toJSONSchema(command.inputSchema),
        outputSchema: z.toJSONSchema(command.outputSchema),
      }
    }),
  }
}

