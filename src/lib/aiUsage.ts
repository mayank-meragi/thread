import type { LanguageModelMiddleware } from 'ai'
import { db, type AIUsageAggregateRecord } from '../db'
import type { AIProvider } from './ai'
import { isoToday, shiftDay } from './dates'

export type AIUsageFeature = 'chat' | 'persona-builder' | 'connection-test'
export type AIUsagePeriod = 'today' | '30-days' | 'all-time'

export interface AIUsageContext {
  provider: AIProvider
  model: string
  feature: AIUsageFeature
}

export interface ModelPrice {
  inputUsdPerMillion: number
  outputUsdPerMillion: number
  checkedAt: string
}

export interface AIUsageSummary {
  runCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostUsd: number
  unpricedRunCount: number
}

export interface AIUsageBreakdownRow extends AIUsageSummary {
  id: string
  provider: AIProvider
  model: string
  feature: AIUsageFeature
}

type ProviderUsage = {
  inputTokens?: number | { total?: number }
  outputTokens?: number | { total?: number }
}

const DEVICE_ID_KEY = 'thread.ai.device-id'
const PRICE_OVERRIDES_KEY = 'thread.ai.price-overrides'
export const PRICE_CATALOG_DATE = '2026-09-08'

const MODEL_PRICES: Record<string, ModelPrice> = {
  'openai:gpt-5.6-luna': { inputUsdPerMillion: 0.20, outputUsdPerMillion: 1.20, checkedAt: PRICE_CATALOG_DATE },
  'openai:gpt-5.6-terra': { inputUsdPerMillion: 2.00, outputUsdPerMillion: 12.00, checkedAt: PRICE_CATALOG_DATE },
  'google:gemini-flash-latest': { inputUsdPerMillion: 1.50, outputUsdPerMillion: 9.00, checkedAt: PRICE_CATALOG_DATE },
}

let fallbackDeviceId: string | undefined

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function priceKey(provider: AIProvider, model: string): string {
  return `${provider}:${model.trim()}`
}

function readOverrides(): Record<string, ModelPrice> {
  const raw = storage()?.getItem(PRICE_OVERRIDES_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, ModelPrice>
    return Object.fromEntries(Object.entries(parsed).filter(([, price]) =>
      Number.isFinite(price?.inputUsdPerMillion)
      && price.inputUsdPerMillion >= 0
      && Number.isFinite(price?.outputUsdPerMillion)
      && price.outputUsdPerMillion >= 0,
    ))
  } catch {
    return {}
  }
}

export function getBuiltInModelPrice(provider: AIProvider, model: string): ModelPrice | null {
  return MODEL_PRICES[priceKey(provider, model)] ?? null
}

export function getModelPriceOverride(provider: AIProvider, model: string): ModelPrice | null {
  return readOverrides()[priceKey(provider, model)] ?? null
}

export function getEffectiveModelPrice(provider: AIProvider, model: string): ModelPrice | null {
  return getModelPriceOverride(provider, model) ?? getBuiltInModelPrice(provider, model)
}

export function saveModelPriceOverride(
  provider: AIProvider,
  model: string,
  price: Pick<ModelPrice, 'inputUsdPerMillion' | 'outputUsdPerMillion'>,
): void {
  if (!Number.isFinite(price.inputUsdPerMillion) || price.inputUsdPerMillion < 0
    || !Number.isFinite(price.outputUsdPerMillion) || price.outputUsdPerMillion < 0) {
    throw new Error('AI prices must be non-negative numbers.')
  }
  const target = storage()
  if (!target) return
  const overrides = readOverrides()
  overrides[priceKey(provider, model)] = { ...price, checkedAt: new Date().toISOString().slice(0, 10) }
  target.setItem(PRICE_OVERRIDES_KEY, JSON.stringify(overrides))
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('thread:ai-price-overrides'))
}

export function clearModelPriceOverride(provider: AIProvider, model: string): void {
  const target = storage()
  if (!target) return
  const overrides = readOverrides()
  delete overrides[priceKey(provider, model)]
  target.setItem(PRICE_OVERRIDES_KEY, JSON.stringify(overrides))
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('thread:ai-price-overrides'))
}

export function getAIUsageDeviceId(): string {
  const target = storage()
  const existing = target?.getItem(DEVICE_ID_KEY)
  if (existing) return existing
  const created = fallbackDeviceId ?? crypto.randomUUID()
  fallbackDeviceId = created
  target?.setItem(DEVICE_ID_KEY, created)
  return created
}

function tokenCount(value: ProviderUsage['inputTokens']): number | undefined {
  const raw = typeof value === 'number' ? value : value?.total
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, raw) : undefined
}

async function recordAIUsage(context: AIUsageContext, usage: ProviderUsage): Promise<void> {
  const rawInput = tokenCount(usage.inputTokens)
  const rawOutput = tokenCount(usage.outputTokens)
  if (rawInput === undefined && rawOutput === undefined) return

  const inputTokens = rawInput ?? 0
  const outputTokens = rawOutput ?? 0
  const deviceId = getAIUsageDeviceId()
  const day = isoToday()
  const id = JSON.stringify([deviceId, day, context.provider, context.model, context.feature])
  const price = getEffectiveModelPrice(context.provider, context.model)
  const estimatedCostUsd = price
    ? (inputTokens * price.inputUsdPerMillion + outputTokens * price.outputUsdPerMillion) / 1_000_000
    : 0
  const now = new Date().toISOString()

  await db.transaction('rw', [db.aiUsageAggregates, db.outbox], async () => {
    const current = await db.aiUsageAggregates.get(id)
    await db.aiUsageAggregates.put({
      id,
      deviceId,
      day,
      provider: context.provider,
      model: context.model,
      feature: context.feature,
      runCount: (current?.runCount ?? 0) + 1,
      inputTokens: (current?.inputTokens ?? 0) + inputTokens,
      outputTokens: (current?.outputTokens ?? 0) + outputTokens,
      estimatedCostUsd: (current?.estimatedCostUsd ?? 0) + estimatedCostUsd,
      unpricedRunCount: (current?.unpricedRunCount ?? 0) + (price ? 0 : 1),
      updatedAt: now,
    })
    await db.outbox.put({ key: 'ai-usage', kind: 'ai-usage', aggregateId: 'ai-usage', createdAt: now, attempts: 0 })
  })
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('thread:local-write'))
}

async function safelyRecordUsage(context: AIUsageContext, usage: ProviderUsage | undefined): Promise<void> {
  if (!usage) return
  try {
    await recordAIUsage(context, usage)
  } catch (error) {
    console.warn('Could not record AI usage.', error)
  }
}

export function createAIUsageMiddleware(context: AIUsageContext): LanguageModelMiddleware {
  return {
    specificationVersion: 'v4',
    async wrapGenerate({ doGenerate }) {
      const result = await doGenerate()
      await safelyRecordUsage(context, result.usage)
      return result
    },
    async wrapStream({ doStream }) {
      const result = await doStream()
      return {
        ...result,
        stream: result.stream.pipeThrough(new TransformStream({
          async transform(part, controller) {
            if (part.type === 'finish') await safelyRecordUsage(context, part.usage)
            controller.enqueue(part)
          },
        })),
      }
    },
  }
}

function inPeriod(record: AIUsageAggregateRecord, period: AIUsagePeriod, today: string): boolean {
  if (period === 'all-time') return true
  if (period === 'today') return record.day === today
  return record.day >= shiftDay(today, -29) && record.day <= today
}

function emptySummary(): AIUsageSummary {
  return { runCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, unpricedRunCount: 0 }
}

function addRecord(summary: AIUsageSummary, record: AIUsageAggregateRecord): void {
  summary.runCount += record.runCount
  summary.inputTokens += record.inputTokens
  summary.outputTokens += record.outputTokens
  summary.totalTokens += record.inputTokens + record.outputTokens
  summary.estimatedCostUsd += record.estimatedCostUsd
  summary.unpricedRunCount += record.unpricedRunCount
}

export function summarizeAIUsage(
  records: AIUsageAggregateRecord[],
  period: AIUsagePeriod,
  today = isoToday(),
): AIUsageSummary {
  const summary = emptySummary()
  for (const record of records) if (inPeriod(record, period, today)) addRecord(summary, record)
  return summary
}

export function groupAIUsage(
  records: AIUsageAggregateRecord[],
  period: AIUsagePeriod,
  today = isoToday(),
): AIUsageBreakdownRow[] {
  const groups = new Map<string, AIUsageBreakdownRow>()
  for (const record of records) {
    if (!inPeriod(record, period, today)) continue
    const id = JSON.stringify([record.provider, record.model, record.feature])
    const row = groups.get(id) ?? { id, provider: record.provider, model: record.model, feature: record.feature, ...emptySummary() }
    addRecord(row, record)
    groups.set(id, row)
  }
  return Array.from(groups.values()).sort((left, right) =>
    right.estimatedCostUsd - left.estimatedCostUsd || right.totalTokens - left.totalTokens || left.id.localeCompare(right.id),
  )
}

export function formatAIUsageCost(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: value < 0.01 ? 4 : 2, maximumFractionDigits: value < 0.01 ? 4 : 2,
  }).format(value)
}
