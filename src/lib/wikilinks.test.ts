import { describe, expect, it } from 'vitest'
import { editorLinksToWiki, wikiLinksToEditor } from './wikilinks'

describe('wikilink markdown bridge', () => {
  it('renders canonical wikilinks as internal Markdown links', () => {
    expect(wikiLinksToEditor('talk to [[Browser APIs]]')).toBe(
      'talk to [Browser APIs](#/thread/browser-apis "thread-wikilink")',
    )
  })

  it('restores editor links to canonical wikilinks', () => {
    expect(editorLinksToWiki('[Browser](#/thread/browser "thread-wikilink")')).toBe('[[Browser]]')
  })

  it('accepts escaped brackets from Markdown serializers', () => {
    expect(wikiLinksToEditor('\\[\\[Browser\\]\\]')).toContain('[Browser](#/thread/browser')
  })
})
