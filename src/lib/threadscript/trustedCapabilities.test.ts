import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanPreview } from './types'
import { getTrustedCapabilities, isPlanTrusted, revokeCapability, trustCapabilities } from './trustedCapabilities'

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null }
  setItem(key: string, value: string) { this.store.set(key, value) }
  removeItem(key: string) { this.store.delete(key) }
  clear() { this.store.clear() }
}

function preview(steps: Array<{ capability: string; risk: 'write' | 'destructive' | 'external' }>): PlanPreview {
  return {
    languageVersion: 1,
    source: '',
    sourceHash: '',
    risk: steps.some((s) => s.risk === 'external') ? 'external' : steps.some((s) => s.risk === 'destructive') ? 'destructive' : 'write',
    warnings: [],
    steps: steps.map((s, index) => ({
      id: `s${index}`,
      actionIndex: index,
      capability: s.capability,
      risk: s.risk,
      idempotency: 'natural',
      preview: { summary: '', changes: [], warnings: [] },
      status: 'resolved',
      references: [],
    })),
  }
}

beforeEach(() => {
  const storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', { localStorage: storage, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => vi.unstubAllGlobals())

describe('trustedCapabilities', () => {
  it('unions and dedupes across calls and persists sorted', () => {
    trustCapabilities(['thread.create', 'journal.takeNote'])
    trustCapabilities(['thread.create', 'property.set'])
    expect(getTrustedCapabilities()).toEqual(['journal.takeNote', 'property.set', 'thread.create'])
  })

  it('revokes a single capability', () => {
    trustCapabilities(['thread.create', 'journal.takeNote'])
    revokeCapability('thread.create')
    expect(getTrustedCapabilities()).toEqual(['journal.takeNote'])
  })

  it('isPlanTrusted is true only when every write step is trusted', () => {
    trustCapabilities(['thread.create', 'journal.takeNote'])
    expect(isPlanTrusted(preview([{ capability: 'thread.create', risk: 'write' }, { capability: 'journal.takeNote', risk: 'write' }]))).toBe(true)
    expect(isPlanTrusted(preview([{ capability: 'thread.create', risk: 'write' }, { capability: 'property.remove', risk: 'write' }]))).toBe(false)
  })

  it('never trusts a destructive or external plan even if the capability is listed', () => {
    trustCapabilities(['thread.content.replace'])
    expect(isPlanTrusted(preview([{ capability: 'thread.content.replace', risk: 'destructive' }]))).toBe(false)
  })

  it('is false for an empty plan', () => {
    trustCapabilities(['thread.create'])
    expect(isPlanTrusted(preview([]))).toBe(false)
  })
})
