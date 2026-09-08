import { db, type AIUsageAggregateRecord } from '../db'

export interface AIUsageManifestV1 {
  schemaVersion: 1
  updatedAt: string
  aggregates: Record<string, AIUsageAggregateRecord>
}

function byId<T extends { id: string }>(records: T[]): Record<string, T> {
  return Object.fromEntries(records.map((record) => [record.id, record]))
}

export async function buildAIUsageManifest(): Promise<AIUsageManifestV1> {
  const aggregates = await db.aiUsageAggregates.toArray()
  return {
    schemaVersion: 1,
    updatedAt: aggregates.map((record) => record.updatedAt).sort().at(-1) ?? new Date(0).toISOString(),
    aggregates: byId(aggregates),
  }
}

export function parseAIUsageManifest(value: string): AIUsageManifestV1 {
  const parsed = JSON.parse(value) as Partial<AIUsageManifestV1>
  if (parsed.schemaVersion !== 1) throw new Error('Unsupported ai-usage.json schema version.')
  return {
    schemaVersion: 1,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
    aggregates: parsed.aggregates ?? {},
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonicalize(source[key])]))
  }
  return value
}

export function serializeAIUsageManifest(manifest: AIUsageManifestV1): string {
  return `${JSON.stringify(canonicalize(manifest), null, 2)}\n`
}

function canonicalJSON(value: unknown): string {
  return JSON.stringify(canonicalize(value)) ?? ''
}

function equal(left: unknown, right: unknown): boolean {
  return canonicalJSON(left) === canonicalJSON(right)
}

function latest(
  left: AIUsageAggregateRecord | undefined,
  right: AIUsageAggregateRecord | undefined,
): AIUsageAggregateRecord | undefined {
  if (!left) return right
  if (!right) return left
  const comparison = left.updatedAt.localeCompare(right.updatedAt)
  if (comparison !== 0) return comparison > 0 ? left : right
  return canonicalJSON(left).localeCompare(canonicalJSON(right)) >= 0 ? left : right
}

export function mergeAIUsageManifests(
  base: AIUsageManifestV1 | undefined,
  local: AIUsageManifestV1,
  remote: AIUsageManifestV1,
): AIUsageManifestV1 {
  const aggregates: Record<string, AIUsageAggregateRecord> = {}
  const ids = new Set([
    ...Object.keys(base?.aggregates ?? {}),
    ...Object.keys(local.aggregates),
    ...Object.keys(remote.aggregates),
  ])
  for (const id of ids) {
    const baseRecord = base?.aggregates[id]
    const localRecord = local.aggregates[id]
    const remoteRecord = remote.aggregates[id]
    const winner = equal(localRecord, baseRecord)
      ? remoteRecord
      : equal(remoteRecord, baseRecord) ? localRecord : latest(localRecord, remoteRecord)
    if (winner) aggregates[id] = winner
  }
  return {
    schemaVersion: 1,
    updatedAt: local.updatedAt.localeCompare(remote.updatedAt) >= 0 ? local.updatedAt : remote.updatedAt,
    aggregates,
  }
}

export async function applyAIUsageManifest(manifest: AIUsageManifestV1): Promise<void> {
  const aggregates = Object.values(manifest.aggregates)
  if (!aggregates.length) return
  await db.transaction('rw', [db.aiUsageAggregates], async () => {
    for (const incoming of aggregates) {
      const current = await db.aiUsageAggregates.get(incoming.id)
      const winner = latest(current, incoming)
      if (winner && winner !== current) await db.aiUsageAggregates.put(winner)
    }
  })
}
