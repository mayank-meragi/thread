import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RSS_SETTINGS, getRssSettings, saveRssSettings, type RssRefreshInterval } from './rssSettings'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

beforeEach(() => {
  const storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', { localStorage: storage, dispatchEvent: vi.fn() })
})

describe('RSS refresh settings', () => {
  it('defaults to a fifteen-minute interval', () => {
    expect(getRssSettings()).toEqual(DEFAULT_RSS_SETTINGS)
  })

  it('persists the off option and rejects unknown values', () => {
    expect(saveRssSettings({ refreshIntervalMs: 0 })).toEqual({ refreshIntervalMs: 0 })
    expect(getRssSettings()).toEqual({ refreshIntervalMs: 0 })
    expect(saveRssSettings({ refreshIntervalMs: 123 as RssRefreshInterval })).toEqual(DEFAULT_RSS_SETTINGS)
  })
})
