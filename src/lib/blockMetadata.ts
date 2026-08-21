import type { BlockKind, OutlineBlock } from './outline'
import { emptyDayMetadata, type DayMetadata, type PropertyValue } from './dayDocument'

export type PropertyType = 'text' | 'rich_text' | 'number' | 'boolean' | 'date' | 'datetime' | 'status' | 'select' | 'multi_select' | 'relation' | 'url'
export type PropertySource = 'explicit' | 'default' | 'derived' | 'automation'

export interface PropertyOption {
  id: string
  label: string
  color?: string
}

export interface PropertyDefinitionRecord {
  id: string
  name: string
  type: PropertyType
  options?: PropertyOption[]
  required?: boolean
  defaultValue?: PropertyValue
  system?: boolean
  hidden?: boolean
  createdAt: string
  updatedAt: string
}

export interface BlockPropertyRecord {
  id: string
  blockId: string
  day: string
  propertyId: string
  value: PropertyValue
  source: PropertySource
  sourceTagId?: string
  updatedAt: string
}

export interface TagDefinitionRecord {
  id: string
  name: string
  color?: string
  propertyIds: string[]
  propertyDefaults?: Record<string, PropertyValue>
  requiredPropertyIds?: string[]
  createdAt: string
  updatedAt: string
}

export interface BlockTagRecord {
  id: string
  blockId: string
  day: string
  tagId: string
  source: 'explicit' | 'inline' | 'automation'
  updatedAt: string
}

export interface BlockIdentityRecord {
  id: string
  path: string
  fingerprint: string
}

export const BUILT_IN_PROPERTIES: Array<Omit<PropertyDefinitionRecord, 'createdAt' | 'updatedAt'>> = [
  { id: 'description', name: 'Description', type: 'rich_text', system: true },
  {
    id: 'status', name: 'Status', type: 'status', system: true,
    options: [
      { id: 'not_started', label: 'Not started' },
      { id: 'in_progress', label: 'In progress' },
      { id: 'blocked', label: 'Blocked' },
      { id: 'done', label: 'Done' },
      { id: 'canceled', label: 'Canceled' },
    ],
  },
  { id: 'status-source', name: 'Status source', type: 'text', system: true, hidden: true },
  { id: 'start-date', name: 'Start date', type: 'date', system: true },
  { id: 'due-date', name: 'Due date', type: 'date', system: true },
  {
    id: 'priority', name: 'Priority', type: 'select', system: true,
    options: [
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
    ],
  },
  { id: 'estimate-minutes', name: 'Estimate', type: 'number', system: true },
]

export function blockPath(block: Pick<OutlineBlock, 'id'>, fallback: string): string {
  const separator = block.id.lastIndexOf(':')
  return separator >= 0 ? block.id.slice(separator + 1) : fallback
}

export function fingerprintBlock(block: Pick<OutlineBlock, 'plainText' | 'kind'>): string {
  return `${block.kind}\u0000${block.plainText.trim().toLocaleLowerCase()}`
}

function newBlockId(): string {
  return `block_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
}

/**
 * Reconciles a fresh positional parse against persisted identities. Exact
 * content matches preserve identity across moves; same-path matches preserve
 * identity across edits. The latter is deliberately the fallback so moving
 * an unchanged block wins over an unrelated edit at its former position.
 */
export function reconcileBlockMetadata(
  positionalBlocks: OutlineBlock[],
  previous: DayMetadata | undefined,
): { metadata: DayMetadata; idsByPath: Map<string, string> } {
  const prior = previous ?? emptyDayMetadata()
  const entries = Object.entries(prior.blocks)
  const unused = new Set(entries.map(([id]) => id))
  const idsByPath = new Map<string, string>()
  const next: DayMetadata = { schemaVersion: Math.max(prior.schemaVersion, 1), blocks: {} }

  positionalBlocks.forEach((block, index) => {
    const path = blockPath(block, String(index))
    const fingerprint = fingerprintBlock(block)
    const exact = entries.find(([id, item]) => unused.has(id) && item.fingerprint === fingerprint)
    const samePath = entries.find(([id, item]) => unused.has(id) && item.path === path)
    const selected = exact ?? samePath
    const id = selected?.[0] ?? newBlockId()
    const old = selected?.[1]
    unused.delete(id)
    idsByPath.set(path, id)
    next.blocks[id] = {
      path,
      fingerprint,
      ...(old?.properties && Object.keys(old.properties).length ? { properties: old.properties } : {}),
      ...(old?.propertySources && Object.keys(old.propertySources).length ? { propertySources: old.propertySources } : {}),
      ...(old?.tags?.length ? { tags: old.tags } : {}),
      ...(old?.tagSources && Object.keys(old.tagSources).length ? { tagSources: old.tagSources } : {}),
    }
  })

  return { metadata: next, idsByPath }
}

export function kindLabel(kind: BlockKind): string {
  return kind === 'thought' ? 'Note' : kind.charAt(0).toUpperCase() + kind.slice(1)
}
