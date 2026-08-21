import { describe, expect, it } from 'vitest'
import { editorLinksToTags, tagLinksToEditor } from './taglinks'

describe('tag markdown bridge', () => {
  it('renders a committed tag as an editor link', () => {
    expect(tagLinksToEditor('Plan #[project] today')).toBe(
      'Plan [project](#tag/project "thread-tag") today',
    )
  })

  it('restores editor links to committed tag syntax', () => {
    expect(editorLinksToTags('[project](#tag/project "thread-tag")')).toBe('#[project]')
  })

  it('leaves an unfinished hashtag draft untouched', () => {
    expect(tagLinksToEditor('Plan #proj')).toBe('Plan #proj')
  })
})
