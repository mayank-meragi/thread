import { describe, expect, it } from 'vitest'
import type { ThreadRecord, WorkspaceTombstoneRecord } from '../db'
import { mergeWorkspaceManifests, type WorkspaceManifestV1 } from './syncManifest'

function thread(id: string, title: string, updatedAt: string): ThreadRecord {
  return { id, title, normalizedTitle: title.toLocaleLowerCase(), createdAt: updatedAt, updatedAt }
}

function manifest(threads: ThreadRecord[], tombstones: WorkspaceTombstoneRecord[] = []): WorkspaceManifestV1 {
  return {
    schemaVersion: 1,
    updatedAt: [...threads.map((item) => item.updatedAt), ...tombstones.map((item) => item.deletedAt)].sort().at(-1) ?? new Date(0).toISOString(),
    threads: Object.fromEntries(threads.map((item) => [item.id, item])),
    propertyDefinitions: {}, tagDefinitions: {}, personas: {},
    tombstones: Object.fromEntries(tombstones.map((item) => [item.key, item])),
  }
}

describe('workspace manifest merge', () => {
  it('preserves independent record edits from both devices', () => {
    const base = manifest([thread('one', 'One', '2026-01-01T00:00:00.000Z'), thread('two', 'Two', '2026-01-01T00:00:00.000Z')])
    const local = manifest([thread('one', 'One local', '2026-01-02T00:00:00.000Z'), base.threads.two])
    const remote = manifest([base.threads.one, thread('two', 'Two remote', '2026-01-03T00:00:00.000Z')])

    const merged = mergeWorkspaceManifests(base, local, remote)

    expect(merged.threads.one.title).toBe('One local')
    expect(merged.threads.two.title).toBe('Two remote')
  })

  it('uses the newest timestamp when both devices change the same record', () => {
    const base = manifest([thread('one', 'One', '2026-01-01T00:00:00.000Z')])
    const local = manifest([thread('one', 'Local', '2026-01-02T00:00:00.000Z')])
    const remote = manifest([thread('one', 'Remote', '2026-01-03T00:00:00.000Z')])

    expect(mergeWorkspaceManifests(base, local, remote).threads.one.title).toBe('Remote')
  })

  it('lets a newer tombstone beat an older record', () => {
    const record = thread('one', 'One', '2026-01-02T00:00:00.000Z')
    const tombstone: WorkspaceTombstoneRecord = {
      key: 'threads:one', collection: 'threads', recordId: 'one', deletedAt: '2026-01-03T00:00:00.000Z',
    }
    const merged = mergeWorkspaceManifests(undefined, manifest([record]), manifest([], [tombstone]))

    expect(merged.threads.one).toBeUndefined()
    expect(merged.tombstones['threads:one']).toEqual(tombstone)
  })
})
