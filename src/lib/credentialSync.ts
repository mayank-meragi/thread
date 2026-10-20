import type { AIConfig } from './ai'
import { applySyncedAIConfig, getAIConfig } from './ai'
import { applySyncedRssProxyConfig, getRssProxyConfig, type RssProxyConfig } from './rssProxy'
import { clearCredentialsDirty, isCredentialsDirty, markCredentialsDirty, readCredentialMeta, writeCredentialMeta, type CredentialSection } from './credentialMeta'

// Provider keys and the RSS Worker key live in localStorage, so a new browser
// starts with none of them. When a data repository is connected they are also
// kept in `credentials.json` there: a device that has them pushes, a device
// that doesn't pulls. Each section is last-write-wins on its own `updatedAt`;
// a section with `value: null` is a deliberate disconnect and propagates.
//
// The file holds secrets in plaintext, so it is only ever written to a
// private repository.

export const CREDENTIALS_PATH = 'credentials.json'

interface SectionValues {
  ai: AIConfig
  rssProxy: RssProxyConfig
}

interface StoredSection<K extends CredentialSection> {
  updatedAt: string
  value: SectionValues[K] | null
}

export interface CredentialsManifestV1 {
  schemaVersion: 1
  sections: { [K in CredentialSection]?: StoredSection<K> }
}

export interface CredentialIO {
  read: () => Promise<{ content: string; sha: string } | null>
  write: (content: string, sha?: string) => Promise<void>
  isPrivate: () => Promise<boolean>
}

const SECTIONS: CredentialSection[] = ['ai', 'rssProxy']

export class CredentialConflictError extends Error {}

export function parseCredentialsManifest(content: string): CredentialsManifestV1 {
  const parsed = JSON.parse(content) as Partial<CredentialsManifestV1>
  if (parsed.schemaVersion !== 1) throw new Error('Unsupported credentials.json schema version.')
  return { schemaVersion: 1, sections: parsed.sections ?? {} }
}

function serialize(manifest: CredentialsManifestV1): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

function readLocal(section: CredentialSection): AIConfig | RssProxyConfig | null {
  return section === 'ai' ? getAIConfig() : getRssProxyConfig()
}

function applyLocal(section: CredentialSection, value: unknown): void {
  if (section === 'ai') applySyncedAIConfig(value as AIConfig | null)
  else applySyncedRssProxyConfig(value as RssProxyConfig | null)
}

/** True when this browser holds credentials the repository may not have yet. */
export function queueCredentialsIfPresent(): void {
  if (SECTIONS.some((section) => readLocal(section))) markCredentialsDirty()
}

// Reconcile local credentials with the repository's copy. `force` also runs
// when nothing local changed -- used right after the remote file changed.
export async function syncCredentials(io: CredentialIO, force = false): Promise<void> {
  if (!force && !isCredentialsDirty()) return
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const remoteFile = await io.read()
    const remote = remoteFile ? parseCredentialsManifest(remoteFile.content) : { schemaVersion: 1 as const, sections: {} }
    const meta = readCredentialMeta()
    const outgoing: CredentialsManifestV1['sections'] = { ...remote.sections }
    let push = false

    for (const section of SECTIONS) {
      const incoming = remote.sections[section]
      const localValue = readLocal(section)
      const localStamp = meta[section]
      if (incoming && (!localStamp || incoming.updatedAt > localStamp)) {
        // The repository is newer, or this browser never recorded its own
        // change (first sync): adopt the repository's copy.
        applyLocal(section, incoming.value)
        meta[section] = incoming.updatedAt
      } else if (localStamp && (!incoming || localStamp > incoming.updatedAt)) {
        ;(outgoing as Record<string, unknown>)[section] = { updatedAt: localStamp, value: localValue }
        push = true
      } else if (!localStamp && !incoming && localValue) {
        const updatedAt = new Date().toISOString()
        meta[section] = updatedAt
        ;(outgoing as Record<string, unknown>)[section] = { updatedAt, value: localValue }
        push = true
      }
    }

    writeCredentialMeta(meta)
    if (!push) { clearCredentialsDirty(); return }
    if (!(await io.isPrivate())) {
      throw new Error('Credentials were not synced: the data repository is public. Make it private to sync API keys.')
    }
    try {
      await io.write(serialize({ schemaVersion: 1, sections: outgoing }), remoteFile?.sha)
      clearCredentialsDirty()
      return
    } catch (error) {
      if (!(error instanceof CredentialConflictError) || attempt === 2) throw error
    }
  }
}
