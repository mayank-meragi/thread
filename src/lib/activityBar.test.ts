import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isUserActivityBarHidden, setUserActivityBarHidden, toggleActivityBarHidden } from './activityBar'

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null }
  setItem(key: string, value: string) { this.store.set(key, value) }
  removeItem(key: string) { this.store.delete(key) }
}

describe('activityBar preference', () => {
  beforeEach(() => {
    const storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('window', { localStorage: storage })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is visible by default', () => {
    expect(isUserActivityBarHidden()).toBe(false)
  })

  it('persists a hidden preference and toggles it', () => {
    setUserActivityBarHidden(true)
    expect(isUserActivityBarHidden()).toBe(true)
    expect(toggleActivityBarHidden()).toBe(false)
    expect(isUserActivityBarHidden()).toBe(false)
  })
})
