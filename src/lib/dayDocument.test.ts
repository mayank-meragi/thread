import { describe, expect, it } from 'vitest'
import { emptyDayMetadata, parseDayDocument, serializeDayDocument } from './dayDocument'

describe('day document metadata envelope', () => {
  it('keeps plain Markdown backward compatible', () => {
    expect(parseDayDocument('- A plain note')).toEqual({ markdown: '- A plain note', metadata: emptyDayMetadata() })
  })

  it('round-trips block metadata without exposing it to the editor body', () => {
    const metadata = {
      schemaVersion: 1,
      blocks: {
        block_abc: {
          path: '0',
          fingerprint: 'thought\u0000launch note',
          properties: { description: 'Useful context', score: 4 },
          tags: ['project'],
        },
      },
    }
    const serialized = serializeDayDocument('- Launch note', metadata)
    const parsed = parseDayDocument(serialized)

    expect(serialized).toContain('<!-- thread-metadata')
    expect(parsed).toEqual({ markdown: '- Launch note', metadata })
  })

  it('never strips writing when an envelope is malformed', () => {
    const source = '<!-- thread-metadata\n{broken}\n-->\n- Keep this'
    expect(parseDayDocument(source).markdown).toBe(source)
  })
})
