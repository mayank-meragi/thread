import type { PropertySource } from './blockMetadata'
import { normalizePropertyValue, type PropertyValue } from './dayDocument'

export const THREAD_SCHEMA_VERSION = 1

export interface ThreadPropertySource {
  source: PropertySource
  sourceTagId?: string
}

export interface ThreadMetadata {
  schemaVersion: number
  // propertyId -> value. A thread is a single entity, so unlike a day
  // document there is no per-block map -- properties hang straight off the
  // thread.
  properties: Record<string, PropertyValue>
  propertySources?: Record<string, ThreadPropertySource>
  // Tag ids applied to the thread. Reserved for a later inline-`#[tag]` pass;
  // parsed and preserved here so an envelope written by that future code
  // round-trips through older builds untouched.
  tags?: string[]
}

export interface ParsedThreadDocument {
  markdown: string
  metadata: ThreadMetadata
}

// Shares the exact marker day documents use (see lib/dayDocument.ts). Thread
// notes are stored in their own files, so there is no collision -- keeping the
// token identical means one mental model and one thing to grep for.
const OPEN = '<!-- thread-metadata'
const CLOSE = '-->'

export function emptyThreadMetadata(): ThreadMetadata {
  return { schemaVersion: THREAD_SCHEMA_VERSION, properties: {} }
}

// True when `source` leads with a (possibly malformed) metadata envelope. Lets
// callers tell "an editor handed me body-only Markdown" apart from "this string
// carries authoritative metadata I should adopt".
export function hasThreadMetadataEnvelope(source: string): boolean {
  return source.startsWith(OPEN)
}

export function parseThreadDocument(source: string): ParsedThreadDocument {
  if (!source.startsWith(OPEN)) return { markdown: source, metadata: emptyThreadMetadata() }
  const close = source.indexOf(CLOSE, OPEN.length)
  if (close < 0) return { markdown: source, metadata: emptyThreadMetadata() }
  const raw = source.slice(OPEN.length, close).trim()
  try {
    const value = JSON.parse(raw) as Partial<ThreadMetadata>
    const properties = value.properties && typeof value.properties === 'object' ? value.properties : {}
    const metadata: ThreadMetadata = {
      schemaVersion: typeof value.schemaVersion === 'number' ? value.schemaVersion : THREAD_SCHEMA_VERSION,
      properties,
    }
    if (value.propertySources && typeof value.propertySources === 'object') {
      metadata.propertySources = value.propertySources
    }
    if (Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === 'string')) {
      metadata.tags = value.tags
    }
    return { markdown: source.slice(close + CLOSE.length).replace(/^\r?\n/, ''), metadata }
  } catch {
    // A malformed envelope must never make the user's writing disappear.
    // Treat it as ordinary Markdown and let the conflict/revision history
    // preserve the exact bytes for manual recovery.
    return { markdown: source, metadata: emptyThreadMetadata() }
  }
}

export function serializeThreadDocument(markdown: string, metadata: ThreadMetadata): string {
  const hasProperties = Object.keys(metadata.properties).length > 0
  const hasTags = (metadata.tags?.length ?? 0) > 0
  if (!hasProperties && !hasTags) return markdown
  return `${OPEN}\n${JSON.stringify(metadata, null, 2)}\n${CLOSE}\n${markdown}`
}

export { normalizePropertyValue, type PropertyValue }
