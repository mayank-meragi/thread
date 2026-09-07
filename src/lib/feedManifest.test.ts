import { describe, expect, it } from 'vitest'
import type { FeedFolderRecord, FeedReadRecord, FeedTombstoneRecord } from '../db'
import { mergeFeedManifests, serializeFeedManifest, type FeedManifestV1, type SyncedFeed } from './feedManifest'

function feed(id: string, title: string, updatedAt: string, folderId?: string): SyncedFeed {
  return { id, url: `https://example.com/${id}.xml`, title, folderId, createdAt: updatedAt, updatedAt }
}

function folder(id: string, name: string, updatedAt: string): FeedFolderRecord {
  return { id, name, normalizedName: name.toLocaleLowerCase(), createdAt: updatedAt, updatedAt }
}

function read(id: string, readAt: string | null, updatedAt: string): FeedReadRecord {
  return { id, readAt, updatedAt }
}

function manifest(
  parts: {
    feeds?: SyncedFeed[]
    folders?: FeedFolderRecord[]
    reads?: FeedReadRecord[]
    tombstones?: FeedTombstoneRecord[]
  } = {},
): FeedManifestV1 {
  const { feeds = [], folders = [], reads = [], tombstones = [] } = parts
  return {
    schemaVersion: 1,
    updatedAt: [
      ...feeds.map((f) => f.updatedAt),
      ...folders.map((f) => f.updatedAt),
      ...reads.map((r) => r.updatedAt),
      ...tombstones.map((t) => t.deletedAt),
    ].sort().at(-1) ?? new Date(0).toISOString(),
    feeds: Object.fromEntries(feeds.map((f) => [f.id, f])),
    folders: Object.fromEntries(folders.map((f) => [f.id, f])),
    reads: Object.fromEntries(reads.map((r) => [r.id, r])),
    tombstones: Object.fromEntries(tombstones.map((t) => [t.key, t])),
  }
}

describe('feed manifest merge', () => {
  it('keeps independent feed edits from both devices', () => {
    const base = manifest({ feeds: [feed('a', 'A', '2026-01-01T00:00:00.000Z'), feed('b', 'B', '2026-01-01T00:00:00.000Z')] })
    const local = manifest({ feeds: [feed('a', 'A moved', '2026-01-02T00:00:00.000Z', 'work'), base.feeds.b] })
    const remote = manifest({ feeds: [base.feeds.a, feed('b', 'B renamed', '2026-01-03T00:00:00.000Z')] })

    const merged = mergeFeedManifests(base, local, remote)

    expect(merged.feeds.a.folderId).toBe('work')
    expect(merged.feeds.b.title).toBe('B renamed')
  })

  it('takes the newest write when both devices change the same feed', () => {
    const base = manifest({ feeds: [feed('a', 'A', '2026-01-01T00:00:00.000Z')] })
    const local = manifest({ feeds: [feed('a', 'Local', '2026-01-02T00:00:00.000Z')] })
    const remote = manifest({ feeds: [feed('a', 'Remote', '2026-01-03T00:00:00.000Z')] })

    expect(mergeFeedManifests(base, local, remote).feeds.a.title).toBe('Remote')
  })

  it('lets a newer feed tombstone beat an older record', () => {
    const record = feed('a', 'A', '2026-01-02T00:00:00.000Z')
    const tombstone: FeedTombstoneRecord = {
      key: 'feeds:a', collection: 'feeds', recordId: 'a', deletedAt: '2026-01-03T00:00:00.000Z',
    }
    const merged = mergeFeedManifests(undefined, manifest({ feeds: [record] }), manifest({ tombstones: [tombstone] }))

    expect(merged.feeds.a).toBeUndefined()
    expect(merged.tombstones['feeds:a']).toEqual(tombstone)
  })

  it('re-subscribing after a delete wins when it is newer than the tombstone', () => {
    const tombstone: FeedTombstoneRecord = {
      key: 'feeds:a', collection: 'feeds', recordId: 'a', deletedAt: '2026-01-02T00:00:00.000Z',
    }
    const remote = manifest({ tombstones: [tombstone] })
    const local = manifest({ feeds: [feed('a', 'A again', '2026-01-03T00:00:00.000Z')] })

    const merged = mergeFeedManifests(remote, local, remote)

    expect(merged.feeds.a?.title).toBe('A again')
    expect(merged.tombstones['feeds:a']).toBeUndefined()
  })

  it('resolves read state by newest write in both directions', () => {
    const base = manifest({ reads: [read('a:1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')] })
    // local marked unread later; remote still on the old read timestamp
    const local = manifest({ reads: [read('a:1', null, '2026-01-04T00:00:00.000Z')] })
    const remote = base

    expect(mergeFeedManifests(base, local, remote).reads['a:1'].readAt).toBeNull()

    // remote marks a fresh entry read; local has never seen it
    const local2 = manifest({})
    const remote2 = manifest({ reads: [read('a:2', '2026-01-05T00:00:00.000Z', '2026-01-05T00:00:00.000Z')] })
    expect(mergeFeedManifests(undefined, local2, remote2).reads['a:2'].readAt).toBe('2026-01-05T00:00:00.000Z')
  })

  it('merges folders and reads alongside feeds in one pass', () => {
    const local = manifest({
      feeds: [feed('a', 'A', '2026-01-02T00:00:00.000Z', 'f1')],
      folders: [folder('f1', 'Design', '2026-01-02T00:00:00.000Z')],
      reads: [read('a:1', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')],
    })
    const merged = mergeFeedManifests(undefined, local, manifest({}))
    expect(merged.folders.f1.name).toBe('Design')
    expect(merged.feeds.a.folderId).toBe('f1')
    expect(merged.reads['a:1'].readAt).toBe('2026-01-02T00:00:00.000Z')
  })
})

describe('serializeFeedManifest', () => {
  it('is byte-identical regardless of record insertion order', () => {
    const at = '2026-01-02T00:00:00.000Z'
    const forward: FeedManifestV1 = {
      schemaVersion: 1, updatedAt: at, folders: {}, tombstones: {},
      feeds: { a: feed('a', 'A', at), b: feed('b', 'B', at), c: feed('c', 'C', at) },
      reads: { 'a:1': read('a:1', at, at), 'a:2': read('a:2', at, at) },
    }
    const shuffled: FeedManifestV1 = {
      tombstones: {}, updatedAt: at, schemaVersion: 1,
      reads: { 'a:2': read('a:2', at, at), 'a:1': read('a:1', at, at) },
      feeds: { c: feed('c', 'C', at), a: feed('a', 'A', at), b: feed('b', 'B', at) },
      folders: {},
    }
    expect(serializeFeedManifest(shuffled)).toBe(serializeFeedManifest(forward))
    expect(serializeFeedManifest(forward).endsWith('\n')).toBe(true)
  })
})
