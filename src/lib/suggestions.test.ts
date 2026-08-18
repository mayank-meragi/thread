import { describe, expect, it } from 'vitest'
import { findSuggestionTrigger, rankSlashCommands, rankThreadSuggestions } from './suggestions'

const threads = [
  { id: 'browser-research', title: 'Browser research', updatedAt: '2026-08-18' },
  { id: 'command-bar', title: 'Command bar', updatedAt: '2026-08-17' },
  { id: 'browser', title: 'Browser', updatedAt: '2026-08-16' },
]

describe('inline suggestion triggers', () => {
  it('finds an autocompleted wikilink around the cursor', () => {
    expect(findSuggestionTrigger('Discuss [[bro', ']] later')).toEqual({
      kind: 'wikilink', query: 'bro', fromOffset: 8, toOffset: 15,
    })
  })

  it('opens slash commands at the beginning or current typing position', () => {
    expect(findSuggestionTrigger('/que', '')).toEqual({
      kind: 'slash', query: 'que', fromOffset: 0, toOffset: 4,
    })
    expect(findSuggestionTrigger('Review onboarding /task', ' tomorrow')).toEqual({
      kind: 'slash', query: 'task', fromOffset: 17, toOffset: 23,
    })
    expect(findSuggestionTrigger('/question more', '')).toBeNull()
  })

  it('does not treat URL paths as slash commands', () => {
    expect(findSuggestionTrigger('https://example.com/task', '')).toBeNull()
  })
})

describe('suggestion ranking', () => {
  it('prioritizes exact and prefix thread matches before fuzzy matches', () => {
    expect(rankThreadSuggestions(threads, 'browser').map((thread) => thread.id)).toEqual([
      'browser', 'browser-research',
    ])
    expect(rankThreadSuggestions(threads, 'cmd').map((thread) => thread.id)).toEqual(['command-bar'])
  })

  it('filters slash commands by names and aliases', () => {
    expect(rankSlashCommands('que')[0].id).toBe('question')
    expect(rankSlashCommands('todo')[0].id).toBe('task')
  })
})
