import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, type AIUsageAggregateRecord } from '../db'
import { applyAIUsageManifest, buildAIUsageManifest, mergeAIUsageManifests, parseAIUsageManifest, serializeAIUsageManifest, type AIUsageManifestV1 } from './aiUsageManifest'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

afterAll(() => db.close())

function record(id: string, updatedAt: string, inputTokens = 10): AIUsageAggregateRecord {
  return {
    id, deviceId: id.split(':')[0], day: '2026-09-08', provider: 'openai', model: 'gpt-5.6-luna', feature: 'chat',
    runCount: 1, inputTokens, outputTokens: 5, estimatedCostUsd: 0.000008, unpricedRunCount: 0, updatedAt,
  }
}

function manifest(aggregates: Record<string, AIUsageAggregateRecord>): AIUsageManifestV1 {
  const updatedAt = Object.values(aggregates).map((item) => item.updatedAt).sort().at(-1) ?? new Date(0).toISOString()
  return { schemaVersion: 1, updatedAt, aggregates }
}

describe('AI usage manifest serialization', () => {
  it('sorts nested keys deterministically and round-trips', () => {
    const a = manifest({ b: record('b', '2026-09-08T02:00:00.000Z'), a: record('a', '2026-09-08T01:00:00.000Z') })
    const b = manifest({ a: a.aggregates.a, b: a.aggregates.b })
    expect(serializeAIUsageManifest(a)).toBe(serializeAIUsageManifest(b))
    expect(parseAIUsageManifest(serializeAIUsageManifest(a))).toEqual(a)
    expect(serializeAIUsageManifest(a)).not.toContain('apiKey')
    expect(serializeAIUsageManifest(a)).not.toContain('prompt')
  })

  it('rejects unsupported schema versions', () => {
    expect(() => parseAIUsageManifest('{"schemaVersion":2}')).toThrow('Unsupported ai-usage.json schema version')
  })
})

describe('AI usage manifest merge', () => {
  it('unions records from both devices on initial bootstrap', () => {
    const local = manifest({ local: record('local', '2026-09-08T01:00:00.000Z') })
    const remote = manifest({ remote: record('remote', '2026-09-08T02:00:00.000Z') })
    const merged = mergeAIUsageManifests(undefined, local, remote)
    expect(Object.keys(merged.aggregates).sort()).toEqual(['local', 'remote'])
  })

  it('keeps independent changes and resolves same-record conflicts by timestamp', () => {
    const base = manifest({ a: record('a', '2026-09-08T00:00:00.000Z', 1), b: record('b', '2026-09-08T00:00:00.000Z', 1) })
    const local = manifest({ a: record('a', '2026-09-08T03:00:00.000Z', 3), b: base.aggregates.b })
    const remote = manifest({ a: record('a', '2026-09-08T02:00:00.000Z', 2), b: record('b', '2026-09-08T04:00:00.000Z', 4) })
    const merged = mergeAIUsageManifests(base, local, remote)
    expect(merged.aggregates.a.inputTokens).toBe(3)
    expect(merged.aggregates.b.inputTokens).toBe(4)
  })

  it('uses lexical JSON as a deterministic tie-breaker', () => {
    const base = manifest({ a: record('a', '2026-09-08T00:00:00.000Z', 1) })
    const local = manifest({ a: record('a', '2026-09-08T01:00:00.000Z', 7) })
    const remote = manifest({ a: record('a', '2026-09-08T01:00:00.000Z', 8) })
    expect(mergeAIUsageManifests(base, local, remote).aggregates.a.inputTokens).toBe(8)
  })
})

describe('AI usage manifest persistence', () => {
  it('builds and applies aggregate records without clearing existing history', async () => {
    await db.aiUsageAggregates.put(record('existing', '2026-09-08T01:00:00.000Z'))
    const next = manifest({ imported: record('imported', '2026-09-08T02:00:00.000Z') })
    await applyAIUsageManifest(next)
    expect(await db.aiUsageAggregates.get('existing')).toBeTruthy()
    expect(await db.aiUsageAggregates.get('imported')).toBeTruthy()
    expect(await buildAIUsageManifest()).toMatchObject({ updatedAt: '2026-09-08T02:00:00.000Z' })
  })
})
