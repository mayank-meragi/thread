import { describe, expect, it } from 'vitest'
import { appendMissing, cycleSelection, pruneMru, pushMru } from './tabMru'

describe('pushMru', () => {
  it('moves an existing id to the front without duplicating', () => {
    expect(pushMru(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
  })

  it('adds a new id to the front', () => {
    expect(pushMru(['a', 'b'], 'x')).toEqual(['x', 'a', 'b'])
  })
})

describe('pruneMru', () => {
  it('drops ids that are no longer open', () => {
    expect(pruneMru(['a', 'b', 'c'], new Set(['c', 'a']))).toEqual(['a', 'c'])
  })
})

describe('appendMissing', () => {
  it('keeps the mru order and appends unknown panels in their given order', () => {
    expect(appendMissing(['c'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b'])
  })
})

describe('cycleSelection', () => {
  it('wraps forward', () => {
    expect(cycleSelection(3, 2, 1)).toBe(0)
  })

  it('wraps backward', () => {
    expect(cycleSelection(3, 0, -1)).toBe(2)
  })

  it('handles empty lists and large deltas', () => {
    expect(cycleSelection(0, 0, 1)).toBe(0)
    expect(cycleSelection(2, 1, 7)).toBe(0)
  })
})
