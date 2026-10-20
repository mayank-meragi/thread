import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAIConfig, saveAIConfig, type AIConfig } from './ai'
import { clearCredentialsDirty, isCredentialsDirty, markCredentialsDirty } from './credentialMeta'
import { CredentialConflictError, parseCredentialsManifest, syncCredentials, type CredentialIO } from './credentialSync'
import { getRssProxyConfig, saveRssProxyConfig } from './rssProxy'

const aiConfig: AIConfig = { provider: 'openai', model: 'm', effort: 'off', keys: { openai: 'sk-test' } }

function fakeRepo(initial?: string, isPrivate = true) {
  const state = { content: initial, sha: initial ? 'sha0' : undefined as string | undefined, writes: 0, conflictOnce: false }
  const io: CredentialIO = {
    read: async () => (state.content ? { content: state.content, sha: state.sha! } : null),
    write: async (content, sha) => {
      if (state.conflictOnce) { state.conflictOnce = false; throw new CredentialConflictError('stale') }
      expect(sha).toBe(state.sha)
      state.content = content
      state.sha = `sha${++state.writes}`
    },
    isPrivate: async () => isPrivate,
  }
  return { state, io }
}

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
}

beforeEach(() => {
  const storage = new MemoryStorage()
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', { localStorage: storage, dispatchEvent: vi.fn() })
})

describe('syncCredentials', () => {
  it('pushes credentials this browser has when the repo has none', async () => {
    saveAIConfig(aiConfig)
    saveRssProxyConfig({ baseUrl: 'https://w.example.com', accessKey: 'k' })
    const repo = fakeRepo()
    await syncCredentials(repo.io)
    const manifest = parseCredentialsManifest(repo.state.content!)
    expect(manifest.sections.ai?.value).toEqual(aiConfig)
    expect(manifest.sections.rssProxy?.value).toEqual({ baseUrl: 'https://w.example.com', accessKey: 'k' })
    expect(isCredentialsDirty()).toBe(false)
  })

  it('pulls credentials into a browser that has none', async () => {
    saveAIConfig(aiConfig)
    const source = fakeRepo()
    await syncCredentials(source.io)

    localStorage.clear()
    await syncCredentials(fakeRepo(source.state.content).io, true)
    expect(getAIConfig()).toEqual(aiConfig)
    // Applying remote values must not queue a push back.
    expect(isCredentialsDirty()).toBe(false)
  })

  it('propagates a disconnect and does not resurrect it', async () => {
    saveAIConfig(aiConfig)
    const source = fakeRepo()
    await syncCredentials(source.io)
    const other = localStorage.getItem('thread.ai')!

    // Another browser disconnects later.
    await new Promise((resolve) => setTimeout(resolve, 5))
    const { clearAIConfig } = await import('./ai')
    clearAIConfig()
    await syncCredentials(source.io)
    expect(getAIConfig()).toBeNull()

    // A browser still holding the old copy, stamped earlier, adopts the disconnect.
    localStorage.setItem('thread.ai', other)
    localStorage.setItem('thread.credentials-sync', JSON.stringify({ meta: { ai: '2000-01-01T00:00:00.000Z' }, dirty: false }))
    await syncCredentials(source.io, true)
    expect(getAIConfig()).toBeNull()
  })

  it('refuses to write secrets to a public repository', async () => {
    saveAIConfig(aiConfig)
    const repo = fakeRepo(undefined, false)
    await expect(syncCredentials(repo.io)).rejects.toThrow(/public/)
    expect(repo.state.content).toBeUndefined()
  })

  it('retries after a stale-sha conflict', async () => {
    saveAIConfig(aiConfig)
    const repo = fakeRepo()
    repo.state.conflictOnce = true
    await syncCredentials(repo.io)
    expect(repo.state.writes).toBe(1)
  })

  it('does nothing when nothing changed locally', async () => {
    clearCredentialsDirty()
    const repo = fakeRepo()
    await syncCredentials(repo.io)
    expect(repo.state.content).toBeUndefined()
    markCredentialsDirty()
    expect(getRssProxyConfig()).toBeNull()
  })
})
