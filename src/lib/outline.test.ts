import { describe, expect, it } from 'vitest'
import { cleanMarkdownLine, extractThreadMentions, parseOutline, slugifyThread } from './outline'

describe('outline parsing', () => {
  it('normalizes thread names', () => {
    expect(slugifyThread(' Browser APIs ')).toBe('browser-apis')
  })

  it('extracts task and decision mentions', () => {
    const result = extractThreadMentions('- [ ] Build [[Browser]]\n- DECISION: ship [[Browser]] first', '2026-08-18')
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ threadId: 'browser', kind: 'task', checked: false })
    expect(result[1]).toMatchObject({ threadId: 'browser', kind: 'decision' })
  })

  it('recognizes question, decision, and idea prefixes', () => {
    const result = extractThreadMentions(
      '- ? Which API for [[Browser]]?\n- = Use extensions for [[Browser]]\n- ! Try commands in [[Browser]]',
      '2026-08-18',
    )
    expect(result.map((item) => item.kind)).toEqual(['question', 'decision', 'idea'])
  })

  it('recognizes a decision prefix escaped by the Markdown editor', () => {
    const mentions = extractThreadMentions('- \\= Use extensions for [[Browser]]', '2026-08-18')
    const outline = parseOutline('- \\= Use extensions for [[Browser]]', '2026-08-18')

    expect(mentions[0]).toMatchObject({ kind: 'decision', excerpt: 'Use extensions for Browser' })
    expect(outline.blocks[0]).toMatchObject({ kind: 'decision', plainText: 'Use extensions for Browser' })
  })

  it('recognizes answered questions', () => {
    const result = parseOutline('- ? [x] Which API should we use?', '2026-08-18')
    expect(result.blocks[0]).toMatchObject({ kind: 'question', checked: true, plainText: 'Which API should we use?' })
  })

  it('recognizes wikilinks escaped by Markdown serializers', () => {
    const result = extractThreadMentions('- talk to \\[\\[Rahul\\]\\]', '2026-08-18')
    expect(result[0]).toMatchObject({ threadId: 'rahul', title: 'Rahul' })
  })

  it('associates nested blocks with their parent thread', () => {
    const result = extractThreadMentions('- [[Browser]]\n  - Start with omnibox commands', '2026-08-18')
    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({ threadId: 'browser', excerpt: 'Start with omnibox commands' })
  })

  it('preserves a linked root and its ordered descendant subtree', () => {
    const { blocks, occurrences } = parseOutline(
      '- this amazing [[Browser]]\n  - lalala\n    - lalalaa\n- next root',
      '2026-08-18',
    )
    expect(occurrences[0]).toMatchObject({ threadId: 'browser', rootBlockId: '2026-08-18:0' })
    expect(blocks.slice(0, 3).map((block) => [block.parentId, block.plainText])).toEqual([
      [null, 'this amazing Browser'],
      ['2026-08-18:0', 'lalala'],
      ['2026-08-18:0.0', 'lalalaa'],
    ])
    expect(blocks[0].hasChildren).toBe(true)
  })

  it('turns a markdown block into a readable excerpt', () => {
    expect(cleanMarkdownLine('  - **Start** with [[Browser]]')).toBe('Start with Browser')
  })
})
