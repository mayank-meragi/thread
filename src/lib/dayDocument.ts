export const DAY_SCHEMA_VERSION = 2

export type PropertyValue = string | number | boolean | string[] | null

export interface SerializedBlockMetadata {
  path: string
  fingerprint: string
  properties?: Record<string, PropertyValue>
  propertySources?: Record<string, { source: 'explicit' | 'default' | 'derived' | 'automation'; sourceTagId?: string }>
  tags?: string[]
  tagSources?: Record<string, 'explicit' | 'inline' | 'automation'>
}

export interface DayMetadata {
  schemaVersion: number
  blocks: Record<string, SerializedBlockMetadata>
}

export interface ParsedDayDocument {
  markdown: string
  metadata: DayMetadata
}

const OPEN = '<!-- thread-metadata'
const CLOSE = '-->'

export function emptyDayMetadata(): DayMetadata {
  return { schemaVersion: DAY_SCHEMA_VERSION, blocks: {} }
}

export function parseDayDocument(source: string): ParsedDayDocument {
  if (!source.startsWith(OPEN)) return { markdown: source, metadata: emptyDayMetadata() }
  const close = source.indexOf(CLOSE, OPEN.length)
  if (close < 0) return { markdown: source, metadata: emptyDayMetadata() }
  const raw = source.slice(OPEN.length, close).trim()
  try {
    const value = JSON.parse(raw) as Partial<DayMetadata>
    const metadata: DayMetadata = {
      schemaVersion: typeof value.schemaVersion === 'number' ? value.schemaVersion : DAY_SCHEMA_VERSION,
      blocks: value.blocks && typeof value.blocks === 'object' ? value.blocks : {},
    }
    return { markdown: source.slice(close + CLOSE.length).replace(/^\r?\n/, ''), metadata }
  } catch {
    // A malformed envelope must never make the user's writing disappear.
    // Treat it as ordinary Markdown and let the conflict/revision history
    // preserve the exact bytes for manual recovery.
    return { markdown: source, metadata: emptyDayMetadata() }
  }
}

export function serializeDayDocument(markdown: string, metadata: DayMetadata): string {
  if (Object.keys(metadata.blocks).length === 0) return markdown
  return `${OPEN}\n${JSON.stringify(metadata, null, 2)}\n${CLOSE}\n${markdown}`
}

export function normalizePropertyValue(value: unknown): PropertyValue {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value as PropertyValue
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value
  throw new Error('This property value is not supported.')
}
