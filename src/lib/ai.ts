import { useEffect, useState } from 'react'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogle } from '@ai-sdk/google'
import { wrapLanguageModel, type JSONValue, type LanguageModel } from 'ai'
import { createAIUsageMiddleware, type AIUsageFeature } from './aiUsage'
import { findModel } from './aiModels'

type WrappableLanguageModel = Parameters<typeof wrapLanguageModel>[0]['model']

const STORAGE_KEY = 'thread.ai'

export type AIProvider = 'anthropic' | 'openai' | 'google'

export type ThinkingEffort = 'off' | 'low' | 'medium' | 'high'

export interface AIConfig {
  provider: AIProvider
  model: string
  effort: ThinkingEffort
  // One key per provider, kept simultaneously so switching provider doesn't
  // drop the others. The active key is `keys[provider]`.
  keys: Partial<Record<AIProvider, string>>
}

// Old shape, before per-provider keys / effort. Still on disk for anyone who
// connected a provider before this change -- migrated on first read.
interface LegacyAIConfig {
  provider: AIProvider
  apiKey: string
  model: string
}

function normalizeConfig(raw: unknown): { config: AIConfig; migrated: boolean } | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<AIConfig> & Partial<LegacyAIConfig>
  if (!value.provider || typeof value.model !== 'string') return null

  // Legacy single-key shape -> fold the one key under its provider.
  if (typeof value.apiKey === 'string' && !value.keys) {
    return {
      migrated: true,
      config: {
        provider: value.provider,
        model: value.model,
        effort: 'off',
        keys: value.apiKey ? { [value.provider]: value.apiKey } : {},
      },
    }
  }

  return {
    migrated: false,
    config: {
      provider: value.provider,
      model: value.model,
      effort: value.effort ?? 'off',
      keys: value.keys && typeof value.keys === 'object' ? value.keys : {},
    },
  }
}

export function getAIConfig(): AIConfig | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const normalized = normalizeConfig(parsed)
  if (!normalized) return null
  // Rewrite the stored value in place so the migration only runs once.
  if (normalized.migrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized.config))
  return normalized.config
}

export function saveAIConfig(config: AIConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  window.dispatchEvent(new Event('thread:ai-config'))
}

export function clearAIConfig(): void {
  localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new Event('thread:ai-config'))
}

export function getActiveKey(config: AIConfig): string | undefined {
  return config.keys[config.provider]
}

export function hasProviderKey(config: AIConfig | null, provider: AIProvider): boolean {
  return Boolean(config?.keys[provider])
}

// A blank config to build on when nothing is stored yet. Defaults the model to
// the first catalog entry for the provider so a partial setup is still usable.
function baseConfig(provider: AIProvider = 'anthropic'): AIConfig {
  return { provider, model: findModel(provider)?.id ?? '', effort: 'off', keys: {} }
}

export function setActiveModel(provider: AIProvider, model: string): void {
  const current = getAIConfig() ?? baseConfig(provider)
  saveAIConfig({ ...current, provider, model })
}

export function setEffort(effort: ThinkingEffort): void {
  const current = getAIConfig() ?? baseConfig()
  saveAIConfig({ ...current, effort })
}

export function setProviderKey(provider: AIProvider, key: string): void {
  const current = getAIConfig() ?? baseConfig(provider)
  saveAIConfig({ ...current, keys: { ...current.keys, [provider]: key } })
}

export function clearProviderKey(provider: AIProvider): void {
  const current = getAIConfig()
  if (!current) return
  const keys = { ...current.keys }
  delete keys[provider]
  saveAIConfig({ ...current, keys })
}

// Reasonable per-provider "thinking" budgets for each effort level. Anthropic
// and Google take an explicit token budget; OpenAI takes a named effort.
const THINKING_BUDGET: Record<Exclude<ThinkingEffort, 'off'>, number> = {
  low: 4_000,
  medium: 10_000,
  high: 24_000,
}

// The `providerOptions` fragment to hand to streamText/generateObject so the
// selected model actually reasons. `undefined` when effort is off or the model
// doesn't support reasoning -- callers spread it, so undefined is a no-op.
export function resolveReasoningOptions(
  config: AIConfig,
): Record<string, Record<string, JSONValue>> | undefined {
  if (config.effort === 'off') return undefined
  if (!findModel(config.provider, config.model)?.reasoning) return undefined
  const budget = THINKING_BUDGET[config.effort]
  if (config.provider === 'anthropic') {
    return { anthropic: { thinking: { type: 'enabled', budgetTokens: budget } } }
  }
  if (config.provider === 'google') {
    return { google: { thinkingConfig: { thinkingBudget: budget, includeThoughts: true } } }
  }
  return { openai: { reasoningEffort: config.effort } }
}

// Switching providers is entirely a config change -- this is the one place
// that branches on which provider is selected. `ai`'s streamText/tool calls
// elsewhere never need to know which provider produced the model.
function resolveRawModel(config: AIConfig): WrappableLanguageModel {
  const apiKey = getActiveKey(config)
  if (!apiKey) throw new Error('Set up an AI provider in Settings before starting a chat.')
  if (config.provider === 'anthropic') {
    // Anthropic's API rejects direct browser calls unless this header is
    // present -- the same "bring your own key, call it from the client"
    // trust model this app already uses for GitHub sync.
    const anthropic = createAnthropic({
      apiKey,
      headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
    })
    return anthropic(config.model)
  }
  if (config.provider === 'google') {
    const google = createGoogle({ apiKey })
    return google(config.model)
  }
  const openai = createOpenAI({ apiKey })
  return openai(config.model)
}

export function resolveModel(config: AIConfig, feature: AIUsageFeature): LanguageModel {
  return wrapLanguageModel({
    model: resolveRawModel(config),
    middleware: createAIUsageMiddleware({ provider: config.provider, model: config.model, feature }),
  })
}

// Live view of the stored config, kept in sync with writes from anywhere
// (composer bar, Settings) via the `thread:ai-config` event and cross-tab
// `storage` events.
export function useAIConfig(): AIConfig | null {
  const [config, setConfig] = useState<AIConfig | null>(() => getAIConfig())
  useEffect(() => {
    const refresh = () => setConfig(getAIConfig())
    window.addEventListener('thread:ai-config', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('thread:ai-config', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])
  return config
}
