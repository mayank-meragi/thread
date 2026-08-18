import { describe, expect, it } from 'vitest'
import { parseOutline } from '../outline'
import { prefixedBlockKinds } from './definitions'

describe('block kind registry', () => {
  it('keeps every prefixed kind detectable by outline.ts using its own prefixText', () => {
    // This is the invariant that broke before: the editor's live-DOM kind
    // detection and outline.ts's markdown-side kind detection each had their
    // own hand-written copy of the same regex, free to drift apart. Now both
    // read prefixPattern from the same registry entry, so if a kind's
    // prefixText no longer parses back to that kind, this fails immediately
    // instead of silently misclassifying blocks in the editor.
    for (const definition of prefixedBlockKinds) {
      const markdown = `- ${definition.prefixText}Some content`
      const { blocks } = parseOutline(markdown, '2026-08-18')
      expect(blocks[0].kind).toBe(definition.id)
    }
  })
})
