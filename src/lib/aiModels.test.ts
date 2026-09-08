import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MODELS,
  findModel,
  getModels,
  modelsForProvider,
  resetModels,
  saveModels,
  type ModelOption,
} from './aiModels'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('window', { dispatchEvent: () => true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getModels', () => {
  it('returns the seed catalog when nothing is stored', () => {
    expect(getModels()).toEqual(DEFAULT_MODELS)
  })

  it('round-trips a saved catalog and drops malformed rows', () => {
    localStorage.setItem('thread.ai.models', JSON.stringify([
      { provider: 'openai', id: 'gpt-x', label: 'GPT X', reasoning: true },
      { provider: 'nonsense', id: 'x' },
      { id: 'no-provider' },
      { provider: 'google', id: 'g-1' },
    ]))
    expect(getModels()).toEqual([
      { provider: 'openai', id: 'gpt-x', label: 'GPT X', reasoning: true },
      { provider: 'google', id: 'g-1', label: 'g-1', reasoning: false },
    ])
  })

  it('falls back to defaults on unparseable storage', () => {
    localStorage.setItem('thread.ai.models', '{not json')
    expect(getModels()).toEqual(DEFAULT_MODELS)
  })
})

describe('saveModels / resetModels', () => {
  it('persists edits and reset clears back to defaults', () => {
    const edited: ModelOption[] = [{ provider: 'anthropic', id: 'claude-x', label: 'Claude X', reasoning: true }]
    saveModels(edited)
    expect(getModels()).toEqual(edited)
    resetModels()
    expect(getModels()).toEqual(DEFAULT_MODELS)
  })
})

describe('modelsForProvider', () => {
  it('filters to the provider, drops blank ids, and dedupes', () => {
    saveModels([
      { provider: 'anthropic', id: 'a-1', label: 'A1', reasoning: true },
      { provider: 'anthropic', id: '', label: 'draft', reasoning: false },
      { provider: 'anthropic', id: 'a-1', label: 'A1 dup', reasoning: false },
      { provider: 'openai', id: 'o-1', label: 'O1', reasoning: false },
    ])
    expect(modelsForProvider('anthropic')).toEqual([
      { provider: 'anthropic', id: 'a-1', label: 'A1', reasoning: true },
    ])
  })
})

describe('findModel', () => {
  it('resolves a model added by the user', () => {
    saveModels([...DEFAULT_MODELS, { provider: 'openai', id: 'gpt-custom', label: 'Custom', reasoning: true }])
    expect(findModel('openai', 'gpt-custom')?.reasoning).toBe(true)
  })

  it('returns the first model for a provider when no id is given', () => {
    expect(findModel('anthropic')?.id).toBe('claude-opus-5')
  })

  it('returns undefined for an unknown id', () => {
    expect(findModel('google', 'not-a-model')).toBeUndefined()
  })
})
