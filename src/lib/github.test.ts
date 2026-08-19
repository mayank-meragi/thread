import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, saveDay } from '../db'
import { saveGitHubConfig, syncPending } from './github'

const DATE = '2026-08-19'

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null }
  setItem(key: string, value: string) { this.store.set(key, value) }
  removeItem(key: string) { this.store.delete(key) }
}

function base64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('window', { dispatchEvent: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

afterAll(() => db.close())

// Reproduces the reported bug: a day that was already synced once (has a
// remoteSha) goes stale -- something else changed the file on GitHub -- and
// the next push gets a 409. Previously this only happened to be caught when
// remoteSha was unset (the "first sync" path); once a day had a known
// remoteSha, a 409 just bubbled up as a raw, repeating sync error with no
// way to resolve it from the UI.
describe('sync conflict recovery', () => {
  it('records a resolvable conflict instead of repeating a raw 409 when a previously-synced day goes stale', async () => {
    await saveDay(DATE, '- original content')
    await db.days.update(DATE, { remoteSha: 'old-sha' })
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 'test-token' })

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ message: 'sha mismatch', status: '409' }), { status: 409 })
      }
      return new Response(JSON.stringify({ content: base64('- someone else changed this'), sha: 'new-sha' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(syncPending()).rejects.toThrow(/changed in the data repository/)

    const conflicts = await db.conflicts.where('day').equals(DATE).toArray()
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      localMarkdown: '- original content',
      remoteMarkdown: '- someone else changed this',
    })
  })

  it('self-heals without recording a conflict when the remote already matches after a 409', async () => {
    await saveDay(DATE, '- same content')
    await db.days.update(DATE, { remoteSha: 'old-sha' })
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 'test-token' })

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ message: 'sha mismatch', status: '409' }), { status: 409 })
      }
      return new Response(JSON.stringify({ content: base64('- same content'), sha: 'new-sha' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const synced = await syncPending()

    expect(synced).toBe(1)
    expect(await db.conflicts.count()).toBe(0)
    expect((await db.days.get(DATE))?.remoteSha).toBe('new-sha')
    expect(await db.outbox.get(`day:${DATE}`)).toBeUndefined()
  })

  it('does not repeatedly hammer the API for an already-open conflict', async () => {
    await saveDay(DATE, '- original content')
    await db.days.update(DATE, { remoteSha: 'old-sha' })
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 'test-token' })

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({}), { status: 409 })
      }
      return new Response(JSON.stringify({ content: base64('- someone else changed this'), sha: 'new-sha' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(syncPending()).rejects.toThrow()
    const callsAfterFirstCycle = fetchMock.mock.calls.length

    await syncPending()
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirstCycle)
    expect(await db.conflicts.where('day').equals(DATE).count()).toBe(1)
  })
})
