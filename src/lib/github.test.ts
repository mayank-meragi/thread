import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, saveDay, saveThreadNote } from '../db'
import { catchUpFromGitHub, pullThreadNote, resolveRepoAssetURL, saveGitHubConfig, syncPending, uploadRepoAsset } from './github'

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

describe('repository catch-up', () => {
  const stateKey = 'owner/repo@main'

  it('stops after an unchanged conditional head request', async () => {
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 'test-token' })
    await db.syncStates.put({
      key: stateKey, repo: 'owner/repo', branch: 'main', headSha: 'same-head', etag: '"head-etag"',
      baselineComplete: true, failureCount: 0,
    })
    const fetchMock = vi.fn(async (...request: [string, RequestInit?]) => {
      void request
      return new Response(null, { status: 304, headers: { etag: '"head-etag"' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await catchUpFromGitHub()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: expect.objectContaining({ 'If-None-Match': '"head-etag"' }) })
    expect((await db.syncStates.get(stateKey))?.headSha).toBe('same-head')
  })

  it('applies only files changed between branch heads and advances the cursor', async () => {
    await saveDay(DATE, '- stale')
    await db.days.update(DATE, { remoteSha: 'old-file-sha', lastSyncedMarkdown: '- stale' })
    await db.outbox.clear()
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 'test-token' })
    await db.syncStates.put({
      key: stateKey, repo: 'owner/repo', branch: 'main', headSha: 'old-head', etag: '"old-etag"',
      baselineComplete: true, failureCount: 0,
    })
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/commits/')) return new Response(JSON.stringify({ sha: 'new-head' }), { status: 200, headers: { etag: '"new-etag"' } })
      if (url.includes('/compare/')) return new Response(JSON.stringify({ status: 'ahead', files: [{ filename: `days/2026/${DATE}.md`, status: 'modified' }] }), { status: 200 })
      if (url.includes('/contents/')) return new Response(JSON.stringify({ content: base64('- fresh from phone'), sha: 'new-file-sha' }), { status: 200 })
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await catchUpFromGitHub()

    expect((await db.days.get(DATE))?.markdown).toBe('- fresh from phone')
    expect((await db.syncStates.get(stateKey))?.headSha).toBe('new-head')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('treats a remotely removed day as authoritative', async () => {
    await saveDay(DATE, '- remove me')
    await db.outbox.clear()
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 'test-token' })
    await db.syncStates.put({
      key: stateKey, repo: 'owner/repo', branch: 'main', headSha: 'old-head', baselineComplete: true, failureCount: 0,
    })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/commits/')) return new Response(JSON.stringify({ sha: 'new-head' }), { status: 200 })
      if (url.includes('/compare/')) return new Response(JSON.stringify({ status: 'ahead', files: [{ filename: `days/2026/${DATE}.md`, status: 'removed' }] }), { status: 200 })
      throw new Error(`Unexpected URL: ${url}`)
    }))

    await catchUpFromGitHub()

    expect(await db.days.get(DATE)).toBeUndefined()
    expect(await db.blocks.where('day').equals(DATE).count()).toBe(0)
  })

  it('performs a full managed-file scan when the device has no baseline', async () => {
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 'test-token' })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/commits/')) return new Response(JSON.stringify({ sha: 'initial-head' }), { status: 200, headers: { etag: '"initial-etag"' } })
      if (url.includes('/git/trees/')) return new Response(JSON.stringify({
        tree: [{ path: `days/2026/${DATE}.md`, type: 'blob', sha: 'day-sha' }], truncated: false,
      }), { status: 200 })
      if (url.includes('/contents/')) return new Response(JSON.stringify({ content: base64('- restored everywhere'), sha: 'day-sha' }), { status: 200 })
      throw new Error(`Unexpected URL: ${url}`)
    }))

    await catchUpFromGitHub()

    expect((await db.days.get(DATE))?.markdown).toBe('- restored everywhere')
    expect(await db.outbox.get('workspace')).toBeDefined()
    expect(await db.syncStates.get(stateKey)).toMatchObject({ headSha: 'initial-head', baselineComplete: true })
  })
})

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

    const conflicts = await db.conflicts.where('aggregateId').equals(DATE).toArray()
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].scope).toBe('day')
    // No lastSyncedMarkdown was ever recorded for this day (remoteSha was
    // set directly, bypassing a real sync), so there's no known merge base
    // and the whole document is treated as one conflict -- same as before
    // three-way merge existed.
    expect(conflicts[0].conflicts).toMatchObject([
      { local: '- original content', remote: '- someone else changed this' },
    ])
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
    expect(await db.conflicts.where('aggregateId').equals(DATE).count()).toBe(1)
  })
})

// Most real-world divergences aren't real conflicts -- they touch different
// parts of the day. These exercise the three-way merge (via node-diff3)
// that resolves those automatically, only recording a ConflictRecord when
// two sides genuinely changed the same lines differently.
describe('three-way auto-merge', () => {
  it('auto-merges edits to different blocks without recording a conflict', async () => {
    await saveDay(DATE, '- Tasks\n- middle\n- Notes')
    // Simulate a prior successful sync: remote and local agree on this
    // content, and it's recorded as the merge base.
    await db.days.update(DATE, { remoteSha: 'base-sha', lastSyncedMarkdown: '- Tasks\n- middle\n- Notes' })
    // A local-only edit to the first line.
    await saveDay(DATE, '- Tasks (updated)\n- middle\n- Notes')
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 'test-token' })

    let putCalls = 0
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        putCalls += 1
        // The first push loses the race (stale parent sha); the retry after
        // the merge, using the fresh sha as parent, succeeds.
        if (putCalls === 1) return new Response(JSON.stringify({ message: 'sha mismatch', status: '409' }), { status: 409 })
        return new Response(JSON.stringify({ content: { sha: 'remote-sha' } }), { status: 200 })
      }
      // Remote independently edited the last line only.
      return new Response(JSON.stringify({ content: base64('- Tasks\n- middle\n- Notes (updated)'), sha: 'remote-sha-before-push' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const synced = await syncPending()

    expect(synced).toBe(1)
    expect(await db.conflicts.count()).toBe(0)
    expect(putCalls).toBe(2)
    const day = await db.days.get(DATE)
    expect(day?.markdown).toBe('- Tasks (updated)\n- middle\n- Notes (updated)')
    expect(day?.remoteSha).toBe('remote-sha')
    expect(await db.outbox.get(`day:${DATE}`)).toBeUndefined()
  })

  it('records only the block that both sides edited differently, not the whole day', async () => {
    await saveDay(DATE, '- Tasks\n- Notes')
    await db.days.update(DATE, { remoteSha: 'base-sha', lastSyncedMarkdown: '- Tasks\n- Notes' })
    // Local edits the first line...
    await saveDay(DATE, '- Tasks (mine)\n- Notes')
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 'test-token' })

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ message: 'sha mismatch', status: '409' }), { status: 409 })
      }
      // ...and remote edits the *same* first line, differently.
      return new Response(JSON.stringify({ content: base64('- Tasks (theirs)\n- Notes'), sha: 'remote-sha' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(syncPending()).rejects.toThrow(/changed in the data repository/)

    const conflicts = await db.conflicts.where('aggregateId').equals(DATE).toArray()
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].conflicts).toMatchObject([
      { local: '- Tasks (mine)', remote: '- Tasks (theirs)' },
    ])
    // The un-conflicting "Notes" line isn't part of the conflict at all.
    expect(conflicts[0].conflicts[0].local).not.toContain('Notes')
  })
})

// Thread notes used to be push-only -- a browser could open the note editor
// on stale content and never learn another device had pushed a newer version.
// pullThreadNote is the reconciliation path; same shape as pullDay.
describe('pullThreadNote', () => {
  const THREAD = 'redesign-onboarding'

  it('adopts the remote note wholesale when there is no pending local edit', async () => {
    await db.threadNotes.put({
      threadId: THREAD,
      markdown: '- local stale',
      blockCount: 1,
      updatedAt: new Date().toISOString(),
      localRevision: 1,
      remoteSha: 'old-sha',
    })
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 'test-token' })
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ content: base64('- remote wins'), sha: 'new-sha' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await pullThreadNote(THREAD)

    const note = await db.threadNotes.get(THREAD)
    expect(note?.markdown).toBe('- remote wins')
    expect(note?.remoteSha).toBe('new-sha')
    expect(note?.lastSyncedMarkdown).toBe('- remote wins')
    expect(await db.conflicts.count()).toBe(0)
    expect(await db.outbox.get(`thread-note:${THREAD}`)).toBeUndefined()
  })

  it('is a no-op when the remote sha already matches the local record', async () => {
    await db.threadNotes.put({
      threadId: THREAD,
      markdown: '- unchanged',
      blockCount: 1,
      updatedAt: new Date().toISOString(),
      localRevision: 1,
      remoteSha: 'same-sha',
    })
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 'test-token' })
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ content: base64('- ignored'), sha: 'same-sha' }), { status: 200 }),
    ))

    await pullThreadNote(THREAD)

    expect((await db.threadNotes.get(THREAD))?.markdown).toBe('- unchanged')
  })

  it('auto-merges a non-overlapping divergence against a pending local edit', async () => {
    await db.threadNotes.put({
      threadId: THREAD,
      markdown: '- Intro\n- middle\n- Outro',
      blockCount: 3,
      updatedAt: new Date().toISOString(),
      localRevision: 1,
      remoteSha: 'base-sha',
      lastSyncedMarkdown: '- Intro\n- middle\n- Outro',
    })
    // Local edits the first line -- queues an outbox entry.
    await saveThreadNote(THREAD, '- Intro (mine)\n- middle\n- Outro')
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 'test-token' })
    // Remote edits only the last line.
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ content: base64('- Intro\n- middle\n- Outro (theirs)'), sha: 'remote-sha' }), { status: 200 }),
    ))

    await pullThreadNote(THREAD)

    expect(await db.conflicts.count()).toBe(0)
    const note = await db.threadNotes.get(THREAD)
    expect(note?.markdown).toBe('- Intro (mine)\n- middle\n- Outro (theirs)')
    // Merged text stays queued for the next push cycle.
    expect(await db.outbox.get(`thread-note:${THREAD}`)).toBeDefined()
  })

  it('records a thread-note conflict when both sides changed the same line', async () => {
    await db.threadNotes.put({
      threadId: THREAD,
      markdown: '- shared line',
      blockCount: 1,
      updatedAt: new Date().toISOString(),
      localRevision: 1,
      remoteSha: 'base-sha',
      lastSyncedMarkdown: '- shared line',
    })
    await saveThreadNote(THREAD, '- shared line, my version')
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 'test-token' })
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ content: base64('- shared line, their version'), sha: 'remote-sha' }), { status: 200 }),
    ))

    await pullThreadNote(THREAD)

    const conflicts = await db.conflicts.where('aggregateId').equals(THREAD).toArray()
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].scope).toBe('thread-note')
  })
})

// Editor images are committed to the data repo under a content-addressed
// assets/ path; the markdown only stores that relative path.
describe('repo image assets', () => {
  it('uploads a file to a content-addressed assets/ path and returns it', async () => {
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 'test-token' })
    const calls: Array<{ url: string; method: string; body?: string }> = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined })
      if ((init?.method ?? 'GET') === 'GET') return new Response('', { status: 404 })
      return new Response(JSON.stringify({ content: { sha: 'asset-sha' } }), { status: 201 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const file = new File([new Uint8Array([1, 2, 3, 4])], 'pasted.png', { type: 'image/png' })
    const src = await uploadRepoAsset(file)

    expect(src).toMatch(/^assets\/[0-9a-f]{64}\.png$/)
    const put = calls.find((call) => call.method === 'PUT')!
    expect(put.url).toBe(`https://api.github.com/repos/owner/repo/contents/${src}`)
    expect(JSON.parse(put.body!).content).toBe(btoa(String.fromCharCode(1, 2, 3, 4)))
  })

  it('skips the upload when the same bytes are already in the repo', async () => {
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 'test-token' })
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ sha: 'already-here' }), { status: 200 })
      }
      throw new Error('should not PUT an asset that already exists')
    })
    vi.stubGlobal('fetch', fetchMock)

    const file = new File([new Uint8Array([9, 9, 9])], 'again.png', { type: 'image/png' })
    const src = await uploadRepoAsset(file)

    expect(src).toMatch(/^assets\/[0-9a-f]{64}\.png$/)
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true)
  })

  it('passes an absolute image URL straight through without fetching', () => {
    saveGitHubConfig({ repo: 'owner/repo', branch: 'main', token: 'test-token' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no fetch for absolute URLs') }))

    expect(resolveRepoAssetURL('https://example.com/cat.png')).toBe('https://example.com/cat.png')
    expect(resolveRepoAssetURL('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
  })
})
