import { blockKindDefinitions, type BlockConversionKind, type BlockKindDefinition } from './blockKinds/definitions'

export type { BlockConversionKind }

export interface ThreadSuggestion {
  id: string
  title: string
  updatedAt: string
}

// The slash menu is just a view over the shared block-kind registry -- a new
// kind registered there appears here with no further changes.
export type SlashCommand = BlockKindDefinition
export const slashCommands: SlashCommand[] = blockKindDefinitions

export type SuggestionTrigger =
  | { kind: 'wikilink'; query: string; fromOffset: number; toOffset: number }
  | { kind: 'slash'; query: string; fromOffset: number; toOffset: number }

export function findSuggestionTrigger(before: string, after: string): SuggestionTrigger | null {
  const wiki = before.match(/\[\[([^\x5b\x5d]*)$/)
  if (wiki) {
    return {
      kind: 'wikilink',
      query: wiki[1],
      fromOffset: before.length - wiki[0].length,
      toOffset: before.length + (after.startsWith(']]') ? 2 : 0),
    }
  }

  const slash = before.match(/(?:^|\s)\/([a-z]*)$/i)
  if (slash) {
    return {
      kind: 'slash',
      query: slash[1],
      fromOffset: before.length - slash[0].length,
      toOffset: before.length,
    }
  }

  return null
}

function fuzzyScore(value: string, rawQuery: string): number {
  const candidate = value.toLocaleLowerCase()
  const query = rawQuery.trim().toLocaleLowerCase()
  if (!query) return 0
  if (candidate === query) return -10
  if (candidate.startsWith(query)) return 0

  const wordIndex = candidate.split(/\s+/).findIndex((word) => word.startsWith(query))
  if (wordIndex >= 0) return 10 + wordIndex

  const substring = candidate.indexOf(query)
  if (substring >= 0) return 25 + substring

  let queryIndex = 0
  let firstMatch = -1
  let previousMatch = -1
  let gaps = 0
  for (let index = 0; index < candidate.length && queryIndex < query.length; index += 1) {
    if (candidate[index] !== query[queryIndex]) continue
    if (firstMatch < 0) firstMatch = index
    if (previousMatch >= 0) gaps += index - previousMatch - 1
    previousMatch = index
    queryIndex += 1
  }
  return queryIndex === query.length ? 50 + firstMatch + gaps : Number.POSITIVE_INFINITY
}

export function rankThreadSuggestions(
  threads: ThreadSuggestion[],
  query: string,
  limit = 6,
): ThreadSuggestion[] {
  return threads
    .map((thread, index) => ({ thread, index, score: fuzzyScore(thread.title, query) }))
    .filter((result) => Number.isFinite(result.score))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((result) => result.thread)
}

export function rankSlashCommands(query: string): SlashCommand[] {
  return slashCommands
    .map((command, index) => ({
      command,
      index,
      score: Math.min(
        fuzzyScore(command.id, query),
        fuzzyScore(command.label, query),
        ...command.aliases.map((alias) => fuzzyScore(alias, query)),
      ),
    }))
    .filter((result) => Number.isFinite(result.score))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((result) => result.command)
}
