import { describe, expect, it } from 'vitest'
import {
  emptyThreadMetadata,
  hasThreadMetadataEnvelope,
  parseThreadDocument,
  serializeThreadDocument,
  type ThreadMetadata,
} from './threadDocument'

describe('parseThreadDocument', () => {
  it('returns bare markdown untouched when there is no envelope', () => {
    const { markdown, metadata } = parseThreadDocument('- hello\n- world')
    expect(markdown).toBe('- hello\n- world')
    expect(metadata).toEqual(emptyThreadMetadata())
  })

  it('decodes the envelope and strips it from the body', () => {
    const source = serializeThreadDocument('- body', {
      schemaVersion: 1,
      properties: { status: 'active', 'estimate-minutes': 30 },
      propertySources: { status: { source: 'explicit' } },
    })
    const { markdown, metadata } = parseThreadDocument(source)
    expect(markdown).toBe('- body')
    expect(metadata.properties).toEqual({ status: 'active', 'estimate-minutes': 30 })
    expect(metadata.propertySources).toEqual({ status: { source: 'explicit' } })
  })

  it('falls back to plain markdown when the envelope JSON is malformed', () => {
    const source = '<!-- thread-metadata\n{ not json ]\n-->\n- body'
    const { markdown, metadata } = parseThreadDocument(source)
    expect(markdown).toBe(source)
    expect(metadata).toEqual(emptyThreadMetadata())
  })

  it('preserves an unknown tags array for forward compatibility', () => {
    const source = serializeThreadDocument('- b', { schemaVersion: 1, properties: { a: 1 }, tags: ['x', 'y'] })
    expect(parseThreadDocument(source).metadata.tags).toEqual(['x', 'y'])
  })
})

describe('serializeThreadDocument', () => {
  it('emits no envelope when there are no properties or tags', () => {
    expect(serializeThreadDocument('- body', emptyThreadMetadata())).toBe('- body')
  })

  it('round-trips through parse', () => {
    const metadata: ThreadMetadata = {
      schemaVersion: 1,
      properties: { priority: 'high', done: true, tags: ['a'] as unknown as string },
      propertySources: { priority: { source: 'automation', sourceTagId: 'roadmap' } },
    }
    const source = serializeThreadDocument('- body\n- more', metadata)
    const parsed = parseThreadDocument(source)
    expect(parsed.markdown).toBe('- body\n- more')
    expect(parsed.metadata.properties).toEqual(metadata.properties)
    expect(parsed.metadata.propertySources).toEqual(metadata.propertySources)
  })
})

describe('hasThreadMetadataEnvelope', () => {
  it('is true only when the string leads with the marker', () => {
    expect(hasThreadMetadataEnvelope('<!-- thread-metadata\n{}\n-->\n- b')).toBe(true)
    expect(hasThreadMetadataEnvelope('- b')).toBe(false)
    expect(hasThreadMetadataEnvelope('text <!-- thread-metadata -->')).toBe(false)
  })
})
