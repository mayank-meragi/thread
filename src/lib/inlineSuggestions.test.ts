import { describe, expect, it } from 'vitest'
import { isTriggerDismissed } from './inlineSuggestions'

describe('isTriggerDismissed', () => {
  it('stays suppressed through further edits at the same trigger position', () => {
    // Both typing (query grows) and Backspace (query shrinks) change `to`/
    // `query` but not `from` -- the fix keys dismissal on `kind:from` alone,
    // so isTriggerDismissed can't see or care which direction the edit went.
    // This is the regression test for the reopen-on-backspace bug.
    const dismissedKey = 'hashtag:12'
    expect(isTriggerDismissed(dismissedKey, { kind: 'hashtag', from: 12 })).toBe(true)
  })

  it('re-arms once the cursor moves to a new trigger occurrence', () => {
    const dismissedKey = 'hashtag:12'
    expect(isTriggerDismissed(dismissedKey, { kind: 'hashtag', from: 40 })).toBe(false)
  })

  it('does not cross-suppress a different trigger kind at the same position', () => {
    const dismissedKey = 'hashtag:12'
    expect(isTriggerDismissed(dismissedKey, { kind: 'wikilink', from: 12 })).toBe(false)
  })

  it('is not suppressed when nothing has been dismissed', () => {
    expect(isTriggerDismissed('', { kind: 'slash', from: 0 })).toBe(false)
  })
})
