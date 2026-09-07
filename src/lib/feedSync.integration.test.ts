import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db'
import { catchUpFromGitHub, runGitHubSyncCycle, saveGitHubConfig, syncPending } from './github'
import { applyFeedManifest, type FeedManifestV1 } from './feedManifest'

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
function decodePutContent(init: RequestInit | undefined): { feeds?: Record<string, { title?: string }> } {
  const encoded = JSON.parse(init?.body as string).content as string
  const binary = atob(encoded.replace(/\s/g, ''))
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))))
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

describe('feed push when feeds.json exists but is empty', () => {
  const EMPTY = JSON.stringify({ schemaVersion: 1, updatedAt: '1970-01-01T00:00:00.000Z', feeds: {}, folders: {}, reads: {}, tombstones: {} }, null, 2) + '\n'

  async function seedLocalFeed() {
    const now = '2026-09-02T00:00:00.000Z'
    await db.feeds.put({ id: 'feed-local', url: 'https://x.com/f.xml', title: 'My Local Feed', createdAt: now, updatedAt: now, lastFetchedAt: now })
  }

  it('pushes local feeds when lastSyncedFeeds is unset and remote is empty', async () => {
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 't' })
    await seedLocalFeed()
    await db.syncStates.put({ key: 'owner/repo@main', repo: 'owner/repo', branch: 'main', headSha: 'h1', etag: '"e1"', baselineComplete: true, failureCount: 0 })
    let putBody: { feeds?: Record<string, { title?: string }> } | undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') { putBody = decodePutContent(init); return new Response(JSON.stringify({ content: { sha: 's2' } }), { status: 200 }) }
      if (url.includes('/commits/')) return new Response(null, { status: 304, headers: { etag: '"e1"' } })
      if (url.includes('/contents/feeds.json')) return new Response(JSON.stringify({ content: base64(EMPTY), sha: 's1' }), { status: 200 })
      throw new Error(`Unexpected URL: ${url}`)
    }))

    await runGitHubSyncCycle()

    expect(putBody?.feeds?.['feed-local']?.title).toBe('My Local Feed')
  })

  it('re-pushes local feeds after pulling an empty feeds.json (lastSyncedFeeds set to empty)', async () => {
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 't' })
    await seedLocalFeed()
    await db.syncStates.put({ key: 'owner/repo@main', repo: 'owner/repo', branch: 'main', headSha: 'h1', etag: '"e1"', baselineComplete: true, failureCount: 0, lastSyncedFeeds: JSON.parse(EMPTY) })
    // A compare that reports feeds.json changed, so pullFeeds runs.
    let lastPut: { feeds?: Record<string, { title?: string }> } | undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') { lastPut = decodePutContent(init); return new Response(JSON.stringify({ content: { sha: 's3' } }), { status: 200 }) }
      if (url.includes('/commits/')) return new Response(JSON.stringify({ sha: 'h2' }), { status: 200, headers: { etag: '"e2"' } })
      if (url.includes('/compare/')) return new Response(JSON.stringify({ status: 'ahead', files: [{ filename: 'feeds.json', status: 'modified' }] }), { status: 200 })
      if (url.includes('/contents/feeds.json')) return new Response(JSON.stringify({ content: base64(EMPTY), sha: 's1' }), { status: 200 })
      throw new Error(`Unexpected URL: ${url}`)
    }))

    await runGitHubSyncCycle()

    expect(await db.feeds.get('feed-local')).toBeTruthy()
    expect(lastPut?.feeds?.['feed-local']?.title).toBe('My Local Feed')
  })
})

describe('feeds.json key-order churn', () => {
  function reorderedFeedsJson() {
    const parsed = JSON.parse(deviceAFeedsJson()) as Record<string, unknown>
    const reversed = Object.fromEntries(Object.entries(parsed).reverse())
    return JSON.stringify(reversed, null, 2) + '\n'
  }

  it('does not re-queue a push when the remote differs only in key order', async () => {
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 't' })
    await db.feeds.put({ id: 'feed-abc', url: 'https://a.com/f.xml', title: 'Feed ABC', createdAt: NOW, updatedAt: NOW })
    await db.feedFolders.put({ id: 'fold-1', name: 'News', normalizedName: 'news', createdAt: NOW, updatedAt: NOW })
    await db.feedReads.put({ id: 'feed-abc:e1', readAt: NOW, updatedAt: NOW })
    await db.syncStates.put({
      key: 'owner/repo@main', repo: 'owner/repo', branch: 'main', headSha: 'head1', etag: '"e1"',
      baselineComplete: true, failureCount: 0, lastSyncedFeeds: JSON.parse(deviceAFeedsJson()),
    })

    let puts = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') { puts += 1; return new Response(JSON.stringify({ content: { sha: 'x' } }), { status: 200 }) }
      if (url.includes('/commits/')) return new Response(JSON.stringify({ sha: 'head2' }), { status: 200, headers: { etag: '"e2"' } })
      if (url.includes('/compare/')) return new Response(JSON.stringify({ status: 'ahead', files: [{ filename: 'feeds.json', status: 'modified' }] }), { status: 200 })
      if (url.includes('/contents/feeds.json')) return new Response(JSON.stringify({ content: base64(reorderedFeedsJson()), sha: 'fsha' }), { status: 200 })
      throw new Error(`Unexpected URL: ${url}`)
    }))

    await runGitHubSyncCycle()

    expect(puts).toBe(0)
    expect(await db.outbox.get('feeds')).toBeUndefined()
  })
})

describe('applyFeedManifest read-marker reconciliation', () => {
  it('drops a read marker the merge omitted when no local entry remains, keeps it when the entry is still cached', async () => {
    await db.feedReads.bulkPut([
      { id: 'feed-x:pruned-elsewhere', readAt: NOW, updatedAt: NOW },
      { id: 'feed-x:still-shown', readAt: NOW, updatedAt: NOW },
    ])
    await db.feedEntries.put({ id: 'feed-x:still-shown', feedId: 'feed-x', externalId: 'still-shown', title: 'Still shown', fetchedAt: NOW, readAt: NOW })

    const manifest: FeedManifestV1 = {
      schemaVersion: 1, updatedAt: NOW, feeds: {}, folders: {}, reads: {}, tombstones: {},
    }
    await applyFeedManifest(manifest)

    expect(await db.feedReads.get('feed-x:pruned-elsewhere')).toBeUndefined()
    expect(await db.feedReads.get('feed-x:still-shown')).toBeTruthy()
  })
})
