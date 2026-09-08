import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type AIUsageAggregateRecord } from '../db'
import { catchUpFromGitHub, runGitHubSyncCycle, saveGitHubConfig, syncPending } from './github'
import { queueAIUsageSync } from '../db'
import { serializeAIUsageManifest, type AIUsageManifestV1 } from './aiUsageManifest'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('window', { dispatchEvent: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined })
})

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
afterAll(() => db.close())

const NOW = '2026-09-08T01:00:00.000Z'

function record(id: string, updatedAt = NOW): AIUsageAggregateRecord {
  return {
    id, deviceId: id, day: '2026-09-08', provider: 'openai', model: 'gpt-5.6-luna', feature: 'chat',
    runCount: 1, inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.000008, unpricedRunCount: 0, updatedAt,
  }
}

function manifest(aggregates: Record<string, AIUsageAggregateRecord>): AIUsageManifestV1 {
  const updatedAt = Object.values(aggregates).map((item) => item.updatedAt).sort().at(-1) ?? new Date(0).toISOString()
  return { schemaVersion: 1, updatedAt, aggregates }
}

function base64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

function validEmptyFeeds() {
  return { schemaVersion: 1, updatedAt: new Date(0).toISOString(), feeds: {}, folders: {}, reads: {}, tombstones: {} }
}

describe('AI usage GitHub sync', () => {
  it('bootstraps an existing device by merging local usage with remote usage', async () => {
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 't' })
    await db.aiUsageAggregates.put(record('local'))
    await db.syncStates.put({
      key: 'owner/repo@main', repo: 'owner/repo', branch: 'main', headSha: 'head1', etag: '"e1"',
      baselineComplete: true, failureCount: 0, lastSyncedFeeds: validEmptyFeeds(),
    })
    const remote = manifest({ remote: record('remote', '2026-09-08T02:00:00.000Z') })
    let pushed: AIUsageManifestV1 | undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const encoded = JSON.parse(init.body as string).content as string
        const binary = atob(encoded.replace(/\s/g, ''))
        pushed = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))))
        return new Response(JSON.stringify({ content: { sha: 'usage2' } }), { status: 200 })
      }
      if (url.includes('/commits/')) return new Response(null, { status: 304, headers: { etag: '"e1"' } })
      if (url.includes('/contents/ai-usage.json')) return new Response(JSON.stringify({ content: base64(serializeAIUsageManifest(remote)), sha: 'usage1' }), { status: 200 })
      throw new Error(`Unexpected URL: ${url}`)
    }))

    await runGitHubSyncCycle()

    expect(Object.keys(pushed?.aggregates ?? {}).sort()).toEqual(['local', 'remote'])
    expect(await db.outbox.get('ai-usage')).toBeUndefined()
    expect((await db.syncStates.get('owner/repo@main'))?.lastSyncedAIUsage).toMatchObject({ aggregates: expect.objectContaining({ local: expect.anything(), remote: expect.anything() }) })
  })

  it('pulls a remote manifest during a full bootstrap without sensitive content', async () => {
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 't' })
    await db.syncStates.put({ key: 'owner/repo@main', repo: 'owner/repo', branch: 'main', baselineComplete: false, failureCount: 0 })
    const remote = manifest({ remote: record('remote') })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/commits/')) return new Response(JSON.stringify({ sha: 'head1' }), { status: 200, headers: { etag: '"e1"' } })
      if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: [{ path: 'ai-usage.json', type: 'blob', sha: 'usage1' }], truncated: false }), { status: 200 })
      if (url.includes('/contents/ai-usage.json')) return new Response(JSON.stringify({ content: base64(serializeAIUsageManifest(remote)), sha: 'usage1' }), { status: 200 })
      throw new Error(`Unexpected URL: ${url}`)
    }))

    await catchUpFromGitHub({ forceFull: true })

    expect(await db.aiUsageAggregates.get('remote')).toBeTruthy()
    expect(serializeAIUsageManifest(remote)).not.toMatch(/prompt|response|apiKey|sessionId/i)
    expect((await db.syncStates.get('owner/repo@main'))?.lastSyncedAIUsage).toEqual(remote)
  })

  it('retries a stale SHA and converges the merged manifest', async () => {
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 't' })
    await db.aiUsageAggregates.put(record('local', '2026-09-08T03:00:00.000Z'))
    await db.syncStates.put({
      key: 'owner/repo@main', repo: 'owner/repo', branch: 'main', baselineComplete: true, failureCount: 0,
      lastSyncedFeeds: validEmptyFeeds(), lastSyncedAIUsage: manifest({}),
    })
    await queueAIUsageSync()
    const oldRemote = manifest({ old: record('old', '2026-09-08T01:00:00.000Z') })
    const freshRemote = manifest({ remote: record('remote', '2026-09-08T02:00:00.000Z') })
    let puts = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts += 1
        return puts === 1
          ? new Response(JSON.stringify({ message: 'stale sha' }), { status: 409 })
          : new Response(JSON.stringify({ content: { sha: 'usage3' } }), { status: 200 })
      }
      if (url.includes('/commits/')) return new Response(JSON.stringify({ sha: 'head2' }), { status: 200 })
      if (url.includes('ref=head2')) return new Response(JSON.stringify({ content: base64(serializeAIUsageManifest(freshRemote)), sha: 'usage2' }), { status: 200 })
      if (url.includes('/contents/ai-usage.json')) return new Response(JSON.stringify({ content: base64(serializeAIUsageManifest(oldRemote)), sha: 'usage1' }), { status: 200 })
      throw new Error(`Unexpected URL: ${url}`)
    }))

    await syncPending()

    expect(puts).toBe(2)
    expect(await db.outbox.get('ai-usage')).toBeUndefined()
    expect(await db.aiUsageAggregates.get('local')).toBeTruthy()
    expect(await db.aiUsageAggregates.get('remote')).toBeTruthy()
  })
})
