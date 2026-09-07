import {
  db,
  type FeedFolderRecord,
  type FeedReadRecord,
  type FeedRecord,
  type FeedTombstoneRecord,
} from '../db'

// `feeds.json` carries the RSS reader's durable state across devices: the
// subscription list, folders, and per-entry read/unread state. It rides the
// same GitHub sync engine as `workspace.json` and uses the same last-write-wins
// + tombstone merge (see mergeFeedManifests below), so the two stay
// structurally in step.

// Volatile per-device fields (`lastFetchedAt`, `lastError`) are deliberately
// excluded so a routine background refresh never rewrites `feeds.json`.
export type SyncedFeed = Omit<FeedRecord, 'lastFetchedAt' | 'lastError'>

export interface FeedManifestV1 {
  schemaVersion: 1
  updatedAt: string
  feeds: Record<string, SyncedFeed>
  folders: Record<string, FeedFolderRecord>
  reads: Record<string, FeedReadRecord>
  tombstones: Record<string, FeedTombstoneRecord>
}

type CollectionName = Exclude<keyof FeedManifestV1, 'schemaVersion' | 'updatedAt' | 'tombstones'>
type ManifestRecord = SyncedFeed | FeedFolderRecord | FeedReadRecord

function byId<T extends { id: string }>(records: T[]): Record<string, T> {
  return Object.fromEntries(records.map((record) => [record.id, record]))
}

function toSyncedFeed(feed: FeedRecord): SyncedFeed {
  const rest = { ...feed }
  delete (rest as Partial<FeedRecord>).lastFetchedAt
  delete (rest as Partial<FeedRecord>).lastError
  return rest
}

export async function buildFeedManifest(): Promise<FeedManifestV1> {
  const [feeds, folders, reads, tombstones] = await Promise.all([
    db.feeds.toArray(),
    db.feedFolders.toArray(),
    db.feedReads.toArray(),
    db.feedTombstones.toArray(),
  ])
  const synced = feeds.map(toSyncedFeed)
  const updatedAt = [
    ...synced.map((item) => item.updatedAt),
    ...folders.map((item) => item.updatedAt),
    ...reads.map((item) => item.updatedAt),
    ...tombstones.map((item) => item.deletedAt),
  ].sort().at(-1) ?? new Date(0).toISOString()
  return {
    schemaVersion: 1,
    updatedAt,
    feeds: byId(synced),
    folders: byId(folders),
    reads: byId(reads),
    tombstones: Object.fromEntries(tombstones.map((item) => [item.key, item])),
  }
}

export function parseFeedManifest(value: string): FeedManifestV1 {
  const parsed = JSON.parse(value) as Partial<FeedManifestV1>
  if (parsed.schemaVersion !== 1) throw new Error('Unsupported feeds.json schema version.')
  return {
    schemaVersion: 1,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
    feeds: parsed.feeds ?? {},
    folders: parsed.folders ?? {},
    reads: parsed.reads ?? {},
    tombstones: parsed.tombstones ?? {},
  }
}

export function serializeFeedManifest(manifest: FeedManifestV1): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function timestamp(value: ManifestRecord | FeedTombstoneRecord | undefined): string {
  if (!value) return ''
  return 'deletedAt' in value ? value.deletedAt : value.updatedAt
}

function latest(
  left: ManifestRecord | FeedTombstoneRecord | undefined,
  right: ManifestRecord | FeedTombstoneRecord | undefined,
): ManifestRecord | FeedTombstoneRecord | undefined {
  if (!left) return right
  if (!right) return left
  const comparison = timestamp(left).localeCompare(timestamp(right))
  if (comparison !== 0) return comparison > 0 ? left : right
  return JSON.stringify(left).localeCompare(JSON.stringify(right)) >= 0 ? left : right
}

function stateFor(
  manifest: FeedManifestV1 | undefined,
  collection: CollectionName,
  id: string,
): ManifestRecord | FeedTombstoneRecord | undefined {
  if (!manifest) return undefined
  const record = manifest[collection][id] as ManifestRecord | undefined
  // Reads have no tombstones; only feeds/folders can be deleted.
  const tombstoneCollection = collection === 'feeds' ? 'feeds' : collection === 'folders' ? 'folders' : null
  const tombstone = tombstoneCollection ? manifest.tombstones[`${tombstoneCollection}:${id}`] : undefined
  return latest(record, tombstone)
}

export function mergeFeedManifests(
  base: FeedManifestV1 | undefined,
  local: FeedManifestV1,
  remote: FeedManifestV1,
): FeedManifestV1 {
  const merged: FeedManifestV1 = {
    schemaVersion: 1,
    updatedAt: local.updatedAt.localeCompare(remote.updatedAt) >= 0 ? local.updatedAt : remote.updatedAt,
    feeds: {}, folders: {}, reads: {}, tombstones: {},
  }
  const collections: CollectionName[] = ['feeds', 'folders', 'reads']
  for (const collection of collections) {
    const tombstoneCollection = collection === 'feeds' ? 'feeds' : collection === 'folders' ? 'folders' : null
    const ids = new Set([
      ...Object.keys(base?.[collection] ?? {}), ...Object.keys(local[collection]), ...Object.keys(remote[collection]),
      ...(tombstoneCollection
        ? [
          ...Object.values(base?.tombstones ?? {}).filter((item) => item.collection === tombstoneCollection).map((item) => item.recordId),
          ...Object.values(local.tombstones).filter((item) => item.collection === tombstoneCollection).map((item) => item.recordId),
          ...Object.values(remote.tombstones).filter((item) => item.collection === tombstoneCollection).map((item) => item.recordId),
        ]
        : []),
    ])
    for (const id of ids) {
      const baseState = stateFor(base, collection, id)
      const localState = stateFor(local, collection, id)
      const remoteState = stateFor(remote, collection, id)
      const winner = equal(localState, baseState)
        ? remoteState
        : equal(remoteState, baseState) ? localState : latest(localState, remoteState)
      if (!winner) continue
      if ('deletedAt' in winner) merged.tombstones[winner.key] = winner
      else (merged[collection] as Record<string, ManifestRecord>)[id] = winner
    }
  }
  return merged
}

// Overwrites the local feed tables with the merged manifest. Feed metadata is
// merged field-wise with the current row so device-local `lastFetchedAt` /
// `lastError` survive. Cached `feedEntries.readAt` is reconciled to whatever the
// merged read state says, for entries this device has actually fetched.
export async function applyFeedManifest(manifest: FeedManifestV1): Promise<void> {
  await db.transaction(
    'rw',
    [db.feeds, db.feedFolders, db.feedEntries, db.feedReads, db.feedTombstones],
    async () => {
      await db.feedTombstones.clear()
      for (const tombstone of Object.values(manifest.tombstones)) {
        await db.feedTombstones.put(tombstone)
        if (tombstone.collection === 'feeds') {
          await db.feeds.delete(tombstone.recordId)
          await db.feedEntries.where('feedId').equals(tombstone.recordId).delete()
          const orphanReads = await db.feedReads.where('id').startsWith(`${tombstone.recordId}:`).primaryKeys()
          if (orphanReads.length) await db.feedReads.bulkDelete(orphanReads)
        }
        if (tombstone.collection === 'folders') await db.feedFolders.delete(tombstone.recordId)
      }

      for (const folder of Object.values(manifest.folders)) await db.feedFolders.put(folder)

      for (const feed of Object.values(manifest.feeds)) {
        const current = await db.feeds.get(feed.id)
        await db.feeds.put({ ...current, ...feed })
      }

      const reads = Object.values(manifest.reads)
      if (reads.length) await db.feedReads.bulkPut(reads)
      for (const read of reads) {
        const entry = await db.feedEntries.get(read.id)
        if (entry && (entry.readAt ?? null) !== read.readAt) {
          await db.feedEntries.update(read.id, { readAt: read.readAt ?? undefined })
        }
      }

      // A read marker the merge dropped (pruned on another device once the
      // entry aged out) is removed here too — but only when this device also
      // has no cached entry for it. If we still show the entry, its marker
      // stays and re-publishes on the next push.
      const kept = new Set(reads.map((read) => read.id))
      const localReadIds = await db.feedReads.toCollection().primaryKeys()
      for (const id of localReadIds) {
        if (kept.has(id as string)) continue
        if (!(await db.feedEntries.get(id as string))) await db.feedReads.delete(id)
      }
    },
  )
}
