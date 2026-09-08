import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type AIUsageAggregateRecord } from '../db'
import {
  createAIUsageMiddleware,
  formatAIUsageCost,
  getBuiltInModelPrice,
  getEffectiveModelPrice,
  groupAIUsage,
  saveModelPriceOverride,
  summarizeAIUsage,
  type AIUsageContext,
} from './aiUsage'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

const context: AIUsageContext = { provider: 'openai', model: 'gpt-5.6-luna', feature: 'chat' }

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  vi.stubGlobal('localStorage', new MemoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

afterAll(() => db.close())

function usage(inputTokens: number, outputTokens: number) {
  return {
    inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: undefined },
  }
}

async function generateTracked(
  trackedContext: AIUsageContext,
  inputTokens: number,
  outputTokens: number,
): Promise<unknown> {
  const middleware = createAIUsageMiddleware(trackedContext)
  return middleware.wrapGenerate!({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'ok' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: usage(inputTokens, outputTokens),
      warnings: [],
    } as never),
  } as never)
}

async function rows(): Promise<AIUsageAggregateRecord[]> {
  return db.aiUsageAggregates.toArray()
}

describe('AI usage middleware', () => {
  it('captures provider usage for generation and preserves the response', async () => {
    const response = await generateTracked(context, 1000, 2000)

    expect(response).toMatchObject({ content: [{ type: 'text', text: 'ok' }] })
    expect(await rows()).toHaveLength(1)
    expect(await rows()).toEqual([expect.objectContaining({
      provider: 'openai', model: context.model, feature: 'chat', runCount: 1,
      inputTokens: 1000, outputTokens: 2000, estimatedCostUsd: 0.0026, unpricedRunCount: 0,
    })])
    expect(await db.outbox.get('ai-usage')).toMatchObject({ kind: 'ai-usage', aggregateId: 'ai-usage' })
  })

  it('attributes generation usage to the required feature', async () => {
    await generateTracked({ ...context, feature: 'persona-builder' }, 3, 4)
    expect((await rows())[0]).toMatchObject({ feature: 'persona-builder', inputTokens: 3, outputTokens: 4 })
  })

  it('captures every streaming finish event and forwards all events unchanged', async () => {
    const middleware = createAIUsageMiddleware(context)
    const parts = [
      { type: 'text-delta', id: 'text-1', delta: 'hello' },
      { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: usage(10, 2) },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: usage(20, 5) },
    ]
    const source = new ReadableStream({
      start(controller) {
        parts.forEach((part) => controller.enqueue(part))
        controller.close()
      },
    })
    const result = await middleware.wrapStream!({ doStream: async () => ({ stream: source }) } as never)
    const received: unknown[] = []
    const reader = result.stream.getReader()
    while (true) {
      const next = await reader.read()
      if (next.done) break
      received.push(next.value)
    }

    expect(received).toEqual(parts)
    expect(await rows()).toHaveLength(1)
    expect((await rows())[0]).toMatchObject({ runCount: 2, inputTokens: 30, outputTokens: 7 })
    expect((await rows())[0].estimatedCostUsd).toBeCloseTo(0.0000144, 12)
  })

  it('does not record streams without a completed finish event', async () => {
    const middleware = createAIUsageMiddleware(context)
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'partial' })
        controller.error(new Error('aborted'))
      },
    })
    const result = await middleware.wrapStream!({ doStream: async () => ({ stream: source }) } as never)
    await expect(result.stream.pipeTo(new WritableStream())).rejects.toThrow('aborted')
    expect(await rows()).toHaveLength(0)
  })

  it('forwards missing-usage responses and does not create an aggregate', async () => {
    const middleware = createAIUsageMiddleware(context)
    const response = await middleware.wrapGenerate!({
      doGenerate: async () => ({ content: [], finishReason: { unified: 'stop', raw: undefined }, warnings: [] } as never),
    } as never)
    expect(response.content).toEqual([])
    expect(await rows()).toHaveLength(0)
  })

  it('never lets a storage failure break generation', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(db, 'transaction').mockRejectedValue(new Error('storage unavailable'))
    const response = await generateTracked(context, 4, 5)
    expect(response).toMatchObject({ content: [{ type: 'text', text: 'ok' }] })
    expect(warning).toHaveBeenCalled()
  })
})

describe('AI usage accounting', () => {
  it('serializes concurrent calls into one accurate aggregate bucket', async () => {
    await Promise.all(Array.from({ length: 20 }, () => generateTracked(context, 10, 5)))
    expect(await rows()).toHaveLength(1)
    expect((await rows())[0]).toMatchObject({ runCount: 20, inputTokens: 200, outputTokens: 100 })
    expect((await rows())[0].estimatedCostUsd).toBeCloseTo(0.00016, 12)
  })

  it('separates model and feature buckets while sharing the device id', async () => {
    await generateTracked(context, 1, 1)
    await generateTracked({ ...context, model: 'gpt-5.6-terra' }, 2, 2)
    await generateTracked({ ...context, feature: 'connection-test' }, 3, 3)
    const records = await rows()
    expect(records).toHaveLength(3)
    expect(new Set(records.map((record) => record.deviceId)).size).toBe(1)
    expect(new Set(records.map((record) => record.id)).size).toBe(3)
  })

  it('uses seeded rates, applies custom overrides, and marks unknown models unpriced', async () => {
    expect(getBuiltInModelPrice('openai', 'gpt-5.6-luna')).toMatchObject({ inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2 })
    expect(getEffectiveModelPrice('google', 'gemini-flash-latest')).toMatchObject({ inputUsdPerMillion: 1.5, outputUsdPerMillion: 9 })

    await generateTracked({ provider: 'anthropic', model: 'claude-custom', feature: 'chat' }, 100, 100)
    expect((await rows())[0]).toMatchObject({ estimatedCostUsd: 0, unpricedRunCount: 1 })

    saveModelPriceOverride('anthropic', 'claude-custom', { inputUsdPerMillion: 2, outputUsdPerMillion: 4 })
    await generateTracked({ provider: 'anthropic', model: 'claude-custom', feature: 'chat' }, 100, 100)
    expect((await rows())[0]).toMatchObject({ runCount: 2, estimatedCostUsd: 0.0006, unpricedRunCount: 1 })
  })

  it('summarizes periods, breakdowns, and cost display rules', () => {
    const records: AIUsageAggregateRecord[] = [
      { id: 'today', deviceId: 'a', day: '2026-09-08', provider: 'openai', model: 'gpt-5.6-luna', feature: 'chat', runCount: 2, inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.005, unpricedRunCount: 0, updatedAt: '2026-09-08T01:00:00.000Z' },
      { id: 'old', deviceId: 'a', day: '2026-08-09', provider: 'google', model: 'gemini-flash-latest', feature: 'chat', runCount: 4, inputTokens: 20, outputTokens: 10, estimatedCostUsd: 0.01, unpricedRunCount: 1, updatedAt: '2026-08-09T01:00:00.000Z' },
      { id: 'recent', deviceId: 'b', day: '2026-08-10', provider: 'google', model: 'gemini-flash-latest', feature: 'persona-builder', runCount: 1, inputTokens: 5, outputTokens: 2, estimatedCostUsd: 0.002, unpricedRunCount: 0, updatedAt: '2026-08-10T01:00:00.000Z' },
    ]
    expect(summarizeAIUsage(records, 'today', '2026-09-08')).toMatchObject({ runCount: 2, inputTokens: 100, outputTokens: 50, totalTokens: 150, estimatedCostUsd: 0.005 })
    expect(summarizeAIUsage(records, '30-days', '2026-08-10')).toMatchObject({ runCount: 5, totalTokens: 37, unpricedRunCount: 1 })
    expect(groupAIUsage(records, 'all-time')).toHaveLength(3)
    expect(formatAIUsageCost(0.0099)).toBe('$0.0099')
    expect(formatAIUsageCost(0.01)).toBe('$0.01')
  })
})
