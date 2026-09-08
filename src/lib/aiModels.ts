import { useEffect, useState } from 'react'
import type { AIProvider } from './ai'

export interface ModelOption {
  provider: AIProvider
  id: string
  label: string
  // Whether the model supports an adjustable thinking / reasoning budget. Drives
  // both the composer's effort control and `resolveReasoningOptions`.
  reasoning: boolean
}

const STORAGE_KEY = 'thread.ai.models'

export const PROVIDER_IDS: AIProvider[] = ['anthropic', 'openai', 'google']

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
}

// Seed catalog -- also what "Reset to defaults" restores. Ids for OpenAI /
// Google match the price keys in `aiUsage.ts` (`MODEL_PRICES`) so cost estimates
// work out of the box.
export const DEFAULT_MODELS: ModelOption[] = [
  { provider: 'anthropic', id: 'claude-opus-5', label: 'Claude Opus 5', reasoning: true },
  { provider: 'anthropic', id: 'claude-sonnet-5', label: 'Claude Sonnet 5', reasoning: true },
  { provider: 'anthropic', id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', reasoning: false },
  { provider: 'openai', id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', reasoning: true },
  { provider: 'openai', id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', reasoning: false },
  { provider: 'google', id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', reasoning: true },
  { provider: 'google', id: 'gemini-flash-latest', label: 'Gemini Flash (latest)', reasoning: false },
]

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function isProvider(value: unknown): value is AIProvider {
  return value === 'anthropic' || value === 'openai' || value === 'google'
}

function sanitize(rows: unknown): ModelOption[] | null {
  if (!Array.isArray(rows)) return null
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .filter((row) => isProvider(row.provider) && typeof row.id === 'string')
    .map((row) => ({
      provider: row.provider as AIProvider,
      id: row.id as string,
      label: typeof row.label === 'string' && row.label.trim() ? (row.label as string) : (row.id as string),
      reasoning: Boolean(row.reasoning),
    }))
}

// The full editable catalog -- includes rows the user is still filling in (blank
// id). Consumers that need a usable list should go through `modelsForProvider`.
export function getModels(): ModelOption[] {
  const raw = storage()?.getItem(STORAGE_KEY)
  if (!raw) return DEFAULT_MODELS
  try {
    return sanitize(JSON.parse(raw)) ?? DEFAULT_MODELS
  } catch {
    return DEFAULT_MODELS
  }
}

export function saveModels(models: ModelOption[]): void {
  const target = storage()
  if (!target) return
  target.setItem(STORAGE_KEY, JSON.stringify(models))
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('thread:ai-models'))
}

export function resetModels(): void {
  storage()?.removeItem(STORAGE_KEY)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('thread:ai-models'))
}

// Selectable models for a provider: real rows only (non-blank id), first match
// per id wins if the user has left a duplicate.
export function modelsForProvider(provider: AIProvider): ModelOption[] {
  const seen = new Set<string>()
  const out: ModelOption[] = []
  for (const model of getModels()) {
    if (model.provider !== provider || !model.id.trim() || seen.has(model.id)) continue
    seen.add(model.id)
    out.push(model)
  }
  return out
}

export function findModel(provider: AIProvider, id?: string): ModelOption | undefined {
  const options = modelsForProvider(provider)
  if (!id) return options[0]
  return options.find((option) => option.id === id)
}

export function modelLabel(provider: AIProvider, id: string): string {
  return findModel(provider, id)?.label ?? id
}

// Live view of the catalog, kept in sync with edits from the Models settings
// table (`thread:ai-models`) and cross-tab `storage` events.
export function useModels(): ModelOption[] {
  const [models, setModels] = useState<ModelOption[]>(() => getModels())
  useEffect(() => {
    const refresh = () => setModels(getModels())
    window.addEventListener('thread:ai-models', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('thread:ai-models', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])
  return models
}
