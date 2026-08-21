import { describe, expect, it } from 'vitest'
import { extractHashtags, slugifyTag } from './hashtags'

describe('inline hashtags', () => {
  it('extracts distinct committed tags without treating drafts as tags', () => {
    expect(extractHashtags('Ship #[Project] with #[design-system], not #draft or https://example.com/#anchor #[Project]')).toEqual([
      'Project',
      'design-system',
    ])
  })

  it('normalizes tag names for matching', () => {
    expect(slugifyTag(' Design_System ')).toBe('design-system')
  })
})
