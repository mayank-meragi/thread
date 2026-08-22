import { describe, expect, it } from 'vitest'
import { isWorkingPath, tabIdForPath, TODAY_TAB_ID } from './tabsModel'

describe('working tab routes', () => {
  it('keeps Today and threads as workspaces', () => {
    expect(isWorkingPath('/')).toBe(true)
    expect(isWorkingPath('/?date=2026-08-22')).toBe(true)
    expect(isWorkingPath('/thread/browser')).toBe(true)
  })

  it('treats the primary destinations as working tabs too', () => {
    expect(isWorkingPath('/tasks')).toBe(true)
    expect(isWorkingPath('/search?q=browser')).toBe(true)
    expect(isWorkingPath('/settings')).toBe(true)
  })

  it('rejects paths outside the known routes', () => {
    expect(isWorkingPath('/unknown')).toBe(false)
  })

  it('uses one Today tab and one tab per thread or destination', () => {
    expect(tabIdForPath('/?date=2026-08-20')).toBe(TODAY_TAB_ID)
    expect(tabIdForPath('/thread/browser?block=one')).toBe('/thread/browser')
    expect(tabIdForPath('/settings?focus=sync')).toBe('/settings')
  })
})
