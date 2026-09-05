import {
  db,
  ensureBuiltInProperties,
  ensureBuiltInTags,
  type PersonaRecord,
  type ThreadRecord,
  type WorkspaceTombstoneRecord,
} from '../db'
import type { PropertyDefinitionRecord, TagDefinitionRecord } from './blockMetadata'
import { ensureGeneralPersona, ensureWorkoutCoachPersona, repairPersonaThreads } from './personas'

export interface WorkspaceManifestV1 {
  schemaVersion: 1
  updatedAt: string
  threads: Record<string, ThreadRecord>
  propertyDefinitions: Record<string, PropertyDefinitionRecord>
  tagDefinitions: Record<string, TagDefinitionRecord>
  personas: Record<string, PersonaRecord>
  tombstones: Record<string, WorkspaceTombstoneRecord>
}

type CollectionName = Exclude<keyof WorkspaceManifestV1, 'schemaVersion' | 'updatedAt' | 'tombstones'>
type ManifestRecord = ThreadRecord | PropertyDefinitionRecord | TagDefinitionRecord | PersonaRecord

function byId<T extends { id: string }>(records: T[]): Record<string, T> {
  return Object.fromEntries(records.map((record) => [record.id, record]))
}

export async function buildWorkspaceManifest(): Promise<WorkspaceManifestV1> {
  const [threads, propertyDefinitions, tagDefinitions, personas, tombstones] = await Promise.all([
    db.threads.toArray(),
    db.propertyDefinitions.toArray(),
    db.tagDefinitions.toArray(),
    db.personas.toArray(),
    db.workspaceTombstones.toArray(),
  ])
  const durableThreads = threads.filter((item) => item.origin === 'manual' || item.isTemplate || personas.some((persona) => persona.threadId === item.id))
  const updatedAt = [
    ...durableThreads.map((item) => item.updatedAt),
    ...propertyDefinitions.map((item) => item.updatedAt),
    ...tagDefinitions.map((item) => item.updatedAt),
    ...personas.map((item) => item.updatedAt),
    ...tombstones.map((item) => item.deletedAt),
  ].sort().at(-1) ?? new Date(0).toISOString()
  return {
    schemaVersion: 1,
    updatedAt,
    threads: byId(durableThreads),
    propertyDefinitions: byId(propertyDefinitions),
    tagDefinitions: byId(tagDefinitions),
    personas: byId(personas),
    tombstones: Object.fromEntries(tombstones.map((item) => [item.key, item])),
  }
}

export function parseWorkspaceManifest(value: string): WorkspaceManifestV1 {
  const parsed = JSON.parse(value) as Partial<WorkspaceManifestV1>
  if (parsed.schemaVersion !== 1) throw new Error('Unsupported workspace.json schema version.')
  return {
    schemaVersion: 1,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
    threads: parsed.threads ?? {},
    propertyDefinitions: parsed.propertyDefinitions ?? {},
    tagDefinitions: parsed.tagDefinitions ?? {},
    personas: parsed.personas ?? {},
    tombstones: parsed.tombstones ?? {},
  }
}

export function serializeWorkspaceManifest(manifest: WorkspaceManifestV1): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function timestamp(value: ManifestRecord | WorkspaceTombstoneRecord | undefined): string {
  if (!value) return ''
  return 'deletedAt' in value ? value.deletedAt : value.updatedAt
}

function latest(
  left: ManifestRecord | WorkspaceTombstoneRecord | undefined,
  right: ManifestRecord | WorkspaceTombstoneRecord | undefined,
): ManifestRecord | WorkspaceTombstoneRecord | undefined {
  if (!left) return right
  if (!right) return left
  const comparison = timestamp(left).localeCompare(timestamp(right))
  if (comparison !== 0) return comparison > 0 ? left : right
  return JSON.stringify(left).localeCompare(JSON.stringify(right)) >= 0 ? left : right
}

function stateFor(manifest: WorkspaceManifestV1 | undefined, collection: CollectionName, id: string): ManifestRecord | WorkspaceTombstoneRecord | undefined {
  if (!manifest) return undefined
  const record = manifest[collection][id] as ManifestRecord | undefined
  const tombstone = manifest.tombstones[`${collection}:${id}`]
  return latest(record, tombstone)
}

export function mergeWorkspaceManifests(
  base: WorkspaceManifestV1 | undefined,
  local: WorkspaceManifestV1,
  remote: WorkspaceManifestV1,
): WorkspaceManifestV1 {
  const merged: WorkspaceManifestV1 = {
    schemaVersion: 1,
    updatedAt: local.updatedAt.localeCompare(remote.updatedAt) >= 0 ? local.updatedAt : remote.updatedAt,
    threads: {}, propertyDefinitions: {}, tagDefinitions: {}, personas: {}, tombstones: {},
  }
  const collections: CollectionName[] = ['threads', 'propertyDefinitions', 'tagDefinitions', 'personas']
  for (const collection of collections) {
    const ids = new Set([
      ...Object.keys(base?.[collection] ?? {}), ...Object.keys(local[collection]), ...Object.keys(remote[collection]),
      ...Object.values(base?.tombstones ?? {}).filter((item) => item.collection === collection).map((item) => item.recordId),
      ...Object.values(local.tombstones).filter((item) => item.collection === collection).map((item) => item.recordId),
      ...Object.values(remote.tombstones).filter((item) => item.collection === collection).map((item) => item.recordId),
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

export async function applyWorkspaceManifest(manifest: WorkspaceManifestV1): Promise<void> {
  await db.transaction('rw', [db.threads, db.propertyDefinitions, db.tagDefinitions, db.personas, db.workspaceTombstones], async () => {
    await db.workspaceTombstones.clear()
    for (const tombstone of Object.values(manifest.tombstones)) {
      await db.workspaceTombstones.put(tombstone)
      if (tombstone.collection === 'threads') await db.threads.delete(tombstone.recordId)
      if (tombstone.collection === 'propertyDefinitions') await db.propertyDefinitions.delete(tombstone.recordId)
      if (tombstone.collection === 'tagDefinitions') await db.tagDefinitions.delete(tombstone.recordId)
      if (tombstone.collection === 'personas') await db.personas.delete(tombstone.recordId)
    }
    if (Object.keys(manifest.threads).length) await db.threads.bulkPut(Object.values(manifest.threads))
    if (Object.keys(manifest.propertyDefinitions).length) await db.propertyDefinitions.bulkPut(Object.values(manifest.propertyDefinitions))
    if (Object.keys(manifest.tagDefinitions).length) await db.tagDefinitions.bulkPut(Object.values(manifest.tagDefinitions))
    if (Object.keys(manifest.personas).length) await db.personas.bulkPut(Object.values(manifest.personas))
  })
  await ensureBuiltInProperties()
  await ensureBuiltInTags()
  await ensureGeneralPersona()
  await ensureWorkoutCoachPersona()
  await repairPersonaThreads()
}
