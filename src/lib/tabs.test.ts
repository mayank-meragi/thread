import { describe, expect, it } from 'vitest'
import { isWorkingPath, tabIdForPath, TODAY_TAB_ID } from './tabsModel'

describe('working tab routes', () => {
  it('keeps Today and threads as workspaces', () => {
    expect(isWorkingPath('/')).toBe(true)
    expect(isWorkingPath('/?date=2026-08-22')).toBe(true)
    expect(isWorkingPath('/thread/browser')).toBe(true)
  })

  it('keeps primary destinations out of working tabs', () => {
    expect(isWorkingPath('/tasks')).toBe(false)
    expect(isWorkingPath('/search?q=browser')).toBe(false)
    expect(isWorkingPath('/settings')).toBe(false)
  })

  it('uses one Today tab and one tab per thread', () => {
    expect(tabIdForPath('/?date=2026-08-20')).toBe(TODAY_TAB_ID)
    expect(tabIdForPath('/thread/browser?block=one')).toBe('/thread/browser')
  })
})
