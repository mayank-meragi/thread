import { applyRemoteDay, db, hasOpenDayConflict, markDaySynced, markThreadNoteSynced, recordDayConflict } from '../db'

const API = 'https://api.github.com'
const STORAGE_KEY = 'thread.github'

export interface GitHubConfig {
  repo: string
  branch: string
  token: string
}

export function getGitHubConfig(): GitHubConfig | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as GitHubConfig
    return value.repo && value.branch && value.token ? value : null
  } catch {
    return null
  }
}

export function saveGitHubConfig(config: GitHubConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  window.dispatchEvent(new Event('thread:github-config'))
}

export function clearGitHubConfig(): void {
  localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new Event('thread:github-config'))
}

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)))
  return btoa(binary)
}

function fromBase64(value: string): string {
  const binary = atob(value.replace(/\s/g, ''))
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
}

async function getRemoteFile(config: GitHubConfig, path: string): Promise<{ content: string; sha: string } | null> {
  const response = await fetch(
    `${API}/repos/${config.repo}/contents/${path}?ref=${encodeURIComponent(config.branch)}`,
    { headers: headers(config.token) },
  )
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Could not read ${path} (${response.status}).`)
  const result = (await response.json()) as { content: string; sha: string }
  return { content: fromBase64(result.content), sha: result.sha }
}

export async function validateGitHub(config: GitHubConfig): Promise<void> {
  const response = await fetch(`${API}/repos/${config.repo}`, { headers: headers(config.token) })
  if (response.status === 401) throw new Error('GitHub rejected this token.')
  if (response.status === 404) throw new Error('Repository not found or not available to this token.')
  if (!response.ok) throw new Error(`GitHub returned ${response.status}.`)
  const repo = (await response.json()) as { permissions?: { push?: boolean }; default_branch?: string }
  if (!repo.permissions?.push) throw new Error('Token needs Contents: read and write access.')

  const branch = await fetch(`${API}/repos/${config.repo}/branches/${encodeURIComponent(config.branch)}`, {
    headers: headers(config.token),
  })
  if (!branch.ok) throw new Error(`Branch “${config.branch}” was not found.`)
}

async function putFile(config: GitHubConfig, path: string, content: string, sha?: string): Promise<string> {
  const response = await fetch(`${API}/repos/${config.repo}/contents/${path}`, {
    method: 'PUT',
    headers: headers(config.token),
    body: JSON.stringify({
      message: `Update ${path}`,
      content: toBase64(content),
      branch: config.branch,
      ...(sha ? { sha } : {}),
    }),
  })
  if (response.status === 409 || response.status === 422) {
    throw new Error(`Conflict while syncing ${path}. Refresh before retrying.`)
  }
  if (!response.ok) throw new Error(`Could not sync ${path} (${response.status}).`)
  const result = (await response.json()) as { content: { sha: string } }
  return result.content.sha
}

export async function syncPending(): Promise<number> {
  const config = getGitHubConfig()
  if (!config) return 0
  const pending = await db.outbox.orderBy('createdAt').toArray()
  let synced = 0
  const failures: string[] = []

  for (const item of pending) {
    try {
      if (item.kind === 'thread-note') {
        const note = await db.threadNotes.get(item.aggregateId)
        if (!note) {
          await db.outbox.delete(item.key)
          continue
        }
        const path = `threads/${note.threadId}.md`
        const remoteSha = note.remoteSha
        if (!remoteSha) {
          const remote = await getRemoteFile(config, path)
          if (remote?.content === note.markdown) {
            await markThreadNoteSynced(note.threadId, remote.sha, note.localRevision)
            synced += 1
            continue
          }
          if (remote) throw new Error(`${path} already contains different notes. The local copy was kept.`)
        }
        const sha = await putFile(config, path, note.markdown, remoteSha)
        await markThreadNoteSynced(note.threadId, sha, note.localRevision)
        synced += 1
        continue
      }

      const day = await db.days.get(item.aggregateId)
      if (!day) {
        await db.outbox.delete(item.key)
        continue
      }

      // An unresolved conflict already describes this exact problem. Retrying
      // it every cycle would hammer the API and pile up a fresh conflict row
      // each time; wait for the user to resolve it instead.
      if (await hasOpenDayConflict(day.date)) continue

      const year = day.date.slice(0, 4)
      const path = `days/${year}/${day.date}.md`
      const remoteSha = day.remoteSha
      if (!remoteSha) {
        const remote = await getRemoteFile(config, path)
        if (remote?.content === day.markdown) {
          await markDaySynced(day.date, remote.sha, day.localRevision)
          synced += 1
          continue
        }
        if (remote) {
          await recordDayConflict(day.date, day.markdown, remote.content)
          throw new Error(`${path} already contains different notes. The local copy was kept.`)
        }
      }
      const sha = await putFile(config, path, day.markdown, remoteSha)
      await markDaySynced(day.date, sha, day.localRevision)
      synced += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await db.outbox.update(item.key, {
        attempts: item.attempts + 1,
        error: message,
      })
      // Keep going -- one stuck item (a conflict, a rate limit) should not
      // block every other unrelated day from syncing this cycle.
      failures.push(message)
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.length === 1 ? failures[0] : `${failures.length} items failed to sync.`)
  }
  return synced
}

// Thread's sync was push-only: a browser only ever sent its own changes to
// GitHub, and never checked whether another device had pushed something
// newer for a day it already has locally. That's how one browser could sit
// on stale content while genuinely believing itself "up to date" -- that
// status only ever reflected an empty local outbox, never agreement with the
// remote. This pulls one day's remote file and reconciles it with the local
// copy: if there's no unsynced local edit, the remote copy simply becomes
// the local one; if there is, that's a real conflict and gets recorded for
// the user to resolve, same as a conflicting push.
export async function pullDay(date: string): Promise<void> {
  const config = getGitHubConfig()
  if (!config) return

  const day = await db.days.get(date)
  const year = date.slice(0, 4)
  const path = `days/${year}/${date}.md`

  let remote: { content: string; sha: string } | null
  try {
    remote = await getRemoteFile(config, path)
  } catch {
    // Transient network/API failure -- don't disrupt the user over a
    // background refresh; the next scheduled pull retries.
    return
  }
  if (!remote || remote.sha === day?.remoteSha) return

  const pendingLocalEdit = await db.outbox.get(`day:${date}`)
  if (!pendingLocalEdit) {
    await applyRemoteDay(date, remote.content, remote.sha)
    return
  }
  if (day && day.markdown !== remote.content) {
    await recordDayConflict(date, day.markdown, remote.content)
  }
}
