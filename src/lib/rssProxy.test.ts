import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearRssProxyConfig, generateRssProxyAccessKey, getRssProxyConfig, saveRssProxyConfig, testRssProxyConnection } from './rssProxy'

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
  vi.restoreAllMocks()
})

describe('RSS proxy settings', () => {
  it('normalizes and persists a Worker URL without query or fragment', () => {
    expect(saveRssProxyConfig({ baseUrl: ' https://proxy.example/// ', accessKey: ' key ' })).toEqual({ baseUrl: 'https://proxy.example', accessKey: 'key' })
    expect(getRssProxyConfig()).toEqual({ baseUrl: 'https://proxy.example', accessKey: 'key' })
    expect(() => saveRssProxyConfig({ baseUrl: 'https://proxy.example?x=1', accessKey: 'key' })).toThrow('query')
  })

  it('generates a 256-bit key and checks the status endpoint', async () => {
    const key = generateRssProxyAccessKey()
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, version: 1 }), { status: 200 })))
    await expect(testRssProxyConnection({ baseUrl: 'https://proxy.example', accessKey: key })).resolves.toBeUndefined()
  })

  it('surfaces auth failures from the status endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'bad key' }), { status: 401 })))
    await expect(testRssProxyConnection({ baseUrl: 'https://proxy.example', accessKey: 'wrong' })).rejects.toThrow('bad key')
    clearRssProxyConfig()
  })
})
