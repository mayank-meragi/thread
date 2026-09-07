import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db'
import { catchUpFromGitHub, runGitHubSyncCycle, saveGitHubConfig, syncPending } from './github'

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null }
  setItem(k: string, v: string) { this.store.set(k, v) }
  removeItem(k: string) { this.store.delete(k) }
}
function base64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((b) => { binary += String.fromCharCode(b) })
  return btoa(binary)
}

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('window', { dispatchEvent: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
afterAll(() => db.close())

const NOW = '2026-09-01T00:00:00.000Z'
function deviceAFeedsJson() {
  return JSON.stringify({
    schemaVersion: 1,
    updatedAt: NOW,
    feeds: { 'feed-abc': { id: 'feed-abc', url: 'https://a.com/f.xml', title: 'Feed ABC', createdAt: NOW, updatedAt: NOW } },
    folders: { 'fold-1': { id: 'fold-1', name: 'News', normalizedName: 'news', createdAt: NOW, updatedAt: NOW } },
    reads: { 'feed-abc:e1': { id: 'feed-abc:e1', readAt: NOW, updatedAt: NOW } },
    tombstones: {},
  }, null, 2) + '\n'
}

describe('feed sync across devices', () => {
  it('full scan writes device A feeds/folders/reads into device B db', async () => {
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 't' })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/commits/')) return new Response(JSON.stringify({ sha: 'head1' }), { status: 200, headers: { etag: '"e1"' } })
      if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: [{ path: 'feeds.json', type: 'blob', sha: 'fsha' }], truncated: false }), { status: 200 })
      if (url.includes('/contents/feeds.json')) return new Response(JSON.stringify({ content: base64(deviceAFeedsJson()), sha: 'fsha' }), { status: 200 })
      throw new Error(`Unexpected URL: ${url}`)
    }))

    await catchUpFromGitHub()

    expect((await db.feeds.get('feed-abc'))?.title).toBe('Feed ABC')
    expect((await db.feedFolders.get('fold-1'))?.name).toBe('News')
    expect((await db.feedReads.get('feed-abc:e1'))?.readAt).toBe(NOW)
  })

  it('bootstraps a device that already had a sync baseline but no feed baseline', async () => {
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 't' })
    // Device B: synced notes for a while under an older build. Its cursor is
    // already past the commit that introduced feeds.json, and it has no
    // `lastSyncedFeeds` and no queued feed sync.
    await db.syncStates.put({
      key: 'owner/repo@main', repo: 'owner/repo', branch: 'main',
      headSha: 'head1', etag: '"e1"', baselineComplete: true, failureCount: 0,
    })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response(JSON.stringify({ content: { sha: 'fsha2' } }), { status: 200 })
      if (url.includes('/commits/')) return new Response(null, { status: 304, headers: { etag: '"e1"' } })
      if (url.includes('/contents/feeds.json')) return new Response(JSON.stringify({ content: base64(deviceAFeedsJson()), sha: 'fsha' }), { status: 200 })
      throw new Error(`Unexpected URL: ${url}`)
    }))

    await runGitHubSyncCycle()

    expect((await db.feeds.get('feed-abc'))?.title).toBe('Feed ABC')
    expect((await db.feedReads.get('feed-abc:e1'))?.readAt).toBe(NOW)
    expect(await db.outbox.get('feeds')).toBeUndefined()
    expect((await db.syncStates.get('owner/repo@main'))?.lastSyncedFeeds).toBeTruthy()

    // Second cycle: baseline is set, so no further feed bootstrap.
    await runGitHubSyncCycle()
    expect(await db.outbox.get('feeds')).toBeUndefined()
  })

  it('pushFeeds from a queued outbox entry pulls remote feeds down', async () => {
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 't' })
    await db.outbox.put({ key: 'feeds', kind: 'feeds', aggregateId: 'feeds', createdAt: new Date().toISOString(), attempts: 0 })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response(JSON.stringify({ content: { sha: 'fsha2' } }), { status: 200 })
      if (url.includes('/contents/feeds.json')) return new Response(JSON.stringify({ content: base64(deviceAFeedsJson()), sha: 'fsha' }), { status: 200 })
      throw new Error(`Unexpected URL: ${url}`)
    }))

    await syncPending()

    expect((await db.feeds.get('feed-abc'))?.title).toBe('Feed ABC')
    expect(await db.outbox.get('feeds')).toBeUndefined()
  })
})
