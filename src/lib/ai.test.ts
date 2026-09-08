import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearProviderKey,
  getActiveKey,
  getAIConfig,
  resolveReasoningOptions,
  setProviderKey,
  type AIConfig,
} from './ai'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

const STORAGE_KEY = 'thread.ai'

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('window', { dispatchEvent: () => true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const modern: AIConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  effort: 'off',
  keys: { anthropic: 'sk-ant', openai: 'sk-oai' },
}

describe('getAIConfig migration', () => {
  it('folds a legacy { provider, apiKey, model } value into per-provider keys and rewrites storage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider: 'openai', apiKey: 'sk-legacy', model: 'gpt-5.6-luna' }))

    const config = getAIConfig()
    expect(config).toEqual({
      provider: 'openai',
      model: 'gpt-5.6-luna',
      effort: 'off',
      keys: { openai: 'sk-legacy' },
    })

    // Rewritten in place -- the next read sees the new shape, not the legacy one.
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(config)
  })

  it('leaves an already-migrated value untouched and defaults a missing effort/keys', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider: 'google', model: 'gemini-2.5-pro' }))
    expect(getAIConfig()).toEqual({ provider: 'google', model: 'gemini-2.5-pro', effort: 'off', keys: {} })
  })
})

describe('per-provider keys', () => {
  it('getActiveKey returns the key for the selected provider', () => {
    expect(getActiveKey(modern)).toBe('sk-ant')
    expect(getActiveKey({ ...modern, provider: 'openai' })).toBe('sk-oai')
    expect(getActiveKey({ ...modern, provider: 'google' })).toBeUndefined()
  })

  it('setProviderKey / clearProviderKey keep the other providers keys intact', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(modern))

    setProviderKey('google', 'sk-goog')
    expect(getAIConfig()!.keys).toEqual({ anthropic: 'sk-ant', openai: 'sk-oai', google: 'sk-goog' })

    clearProviderKey('openai')
    expect(getAIConfig()!.keys).toEqual({ anthropic: 'sk-ant', google: 'sk-goog' })
  })
})

describe('resolveReasoningOptions', () => {
  it('returns undefined when effort is off', () => {
    expect(resolveReasoningOptions({ ...modern, effort: 'off' })).toBeUndefined()
  })

  it('returns undefined for a model that does not support reasoning', () => {
    expect(resolveReasoningOptions({ ...modern, model: 'claude-haiku-4-5-20251001', effort: 'high' })).toBeUndefined()
  })

  it('maps effort to each provider reasoning shape', () => {
    expect(resolveReasoningOptions({ ...modern, provider: 'anthropic', model: 'claude-sonnet-5', effort: 'low' }))
      .toEqual({ anthropic: { thinking: { type: 'enabled', budgetTokens: 4000 } } })

    expect(resolveReasoningOptions({ ...modern, provider: 'openai', model: 'gpt-5.6-terra', effort: 'medium' }))
      .toEqual({ openai: { reasoningEffort: 'medium' } })

    expect(resolveReasoningOptions({ ...modern, provider: 'google', model: 'gemini-2.5-pro', effort: 'high' }))
      .toEqual({ google: { thinkingConfig: { thinkingBudget: 24000, includeThoughts: true } } })
  })
})
