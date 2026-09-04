import { describe, expect, it } from 'vitest'
import { findSuggestionTrigger, rankSlashCommands, rankTagSuggestions, rankThreadSuggestions } from './suggestions'

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

  it('opens tag suggestions for a hashtag draft without matching URL fragments', () => {
    expect(findSuggestionTrigger('Plan with #proj', '')).toEqual({
      kind: 'hashtag', query: 'proj', fromOffset: 10, toOffset: 15,
    })
    expect(findSuggestionTrigger('#', '')).toEqual({ kind: 'hashtag', query: '', fromOffset: 0, toOffset: 1 })
    expect(findSuggestionTrigger('https://example.com/#anchor', '')).toBeNull()
  })
})

describe('suggestion ranking', () => {
  it('prioritizes exact and prefix thread matches before fuzzy matches', () => {
    expect(rankThreadSuggestions(threads, 'browser').map((thread) => thread.id)).toEqual([
      'browser', 'browser-research',
    ])
    expect(rankThreadSuggestions(threads, 'cmd').map((thread) => thread.id)).toEqual(['command-bar'])
  })

  it('matches thread titles case-insensitively across words and substrings', () => {
    expect(rankThreadSuggestions(threads, 'RESEARCH').map((thread) => thread.id)).toEqual(['browser-research'])
    expect(rankThreadSuggestions(threads, 'res').map((thread) => thread.id)).toEqual(['browser-research'])
  })

  it('keeps input order for equal scores and respects the result limit', () => {
    const equalMatches = [
      { id: 'first', title: 'Alpha notes', updatedAt: '2026-08-18' },
      { id: 'second', title: 'Alpha project', updatedAt: '2026-08-17' },
      { id: 'third', title: 'Alpha review', updatedAt: '2026-08-16' },
    ]
    expect(rankThreadSuggestions(equalMatches, 'alpha', 2).map((thread) => thread.id)).toEqual(['first', 'second'])
  })

  it('filters slash commands by names and aliases', () => {
    expect(rankSlashCommands('que')[0].id).toBe('question')
    expect(rankSlashCommands('todo')[0].id).toBe('task')
    expect(rankSlashCommands('workout')[0]).toMatchObject({ id: 'workout', kind: 'semantic-task', tagId: 'system-workout' })
    expect(rankSlashCommands('movement')[0]).toMatchObject({ id: 'exercise', kind: 'semantic-task' })
  })

  it('ranks existing tags by exact and prefix matches', () => {
    const tags = [
      { id: 'project-notes', name: 'project-notes', propertyCount: 0 },
      { id: 'project', name: 'project', propertyCount: 2 },
      { id: 'product', name: 'product', propertyCount: 1 },
    ]
    expect(rankTagSuggestions(tags, 'project').map((tag) => tag.id)).toEqual(['project', 'project-notes'])
  })
})
