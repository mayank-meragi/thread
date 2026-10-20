// Bookkeeping for credential sync, kept apart from ai.ts / rssProxy.ts so they
// can record local changes without importing the sync code (which imports them).

export type CredentialSection = 'ai' | 'rssProxy'

const STORAGE_KEY = 'thread.credentials-sync'

interface State {
  meta: Partial<Record<CredentialSection, string>>
  dirty: boolean
}

function read(): State {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<State>
    return { meta: parsed.meta ?? {}, dirty: Boolean(parsed.dirty) }
  } catch {
    return { meta: {}, dirty: false }
  }
}

function write(state: State): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* storage unavailable */ }
}

export function readCredentialMeta(): State['meta'] {
  return read().meta
}

export function writeCredentialMeta(meta: State['meta']): void {
  write({ ...read(), meta })
}

export function isCredentialsDirty(): boolean {
  return read().dirty
}

export function markCredentialsDirty(): void {
  write({ ...read(), dirty: true })
}

export function clearCredentialsDirty(): void {
  write({ ...read(), dirty: false })
}

/** Called when the user changes or clears a credential in this browser. */
export function markCredentialChanged(section: CredentialSection): void {
  const state = read()
  write({ meta: { ...state.meta, [section]: new Date().toISOString() }, dirty: true })
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('thread:local-write'))
}
