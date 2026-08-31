import { applyMergedDay, applyMergedThreadNote, applyRemoteDay, applyRemoteThreadNote, db, hasOpenConflict, markConflictResolved, markDaySynced, markThreadNoteSynced, recordConflict, saveDay, saveThreadNote, type DayRecord, type ThreadNoteRecord } from '../db'
import { emptyDayMetadata, parseDayDocument, serializeDayDocument } from './dayDocument'
import { applyConflictResolutions, mergeMarkdown } from './conflictMerge'

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

// Thrown when GitHub rejects a write because the sha we sent doesn't match
// the file's current sha -- i.e. our locally stored remoteSha is stale,
// whether because this is the first sync of a day that already has remote
// content, or because something else (another device, a manual edit, a
// pull) changed the remote file since we last knew about it. Distinguished
// from other failures (auth, rate limit, network) so callers can recover
// instead of just retrying the same doomed request forever.
export class SyncConflictError extends Error {}

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
    throw new SyncConflictError(`${path} changed in the data repository since this browser last knew about it.`)
  }
  if (!response.ok) throw new Error(`Could not sync ${path} (${response.status}).`)
  const result = (await response.json()) as { content: { sha: string } }
  return result.content.sha
}

// Pushes one day, unconditionally -- whether this is the very first sync of
// a day that might already have remote content, or a resync of a day whose
// stored remoteSha has since gone stale (another device pushed, a pull
// landed, a manual edit on GitHub). Both are the same situation from
// GitHub's perspective: the sha we send doesn't match what's actually
// there. Rather than trying to predict that in advance (the previous
// version proactively checked only when remoteSha was unset, and had no
// recovery at all for the case where a previously-known sha went stale --
// exactly the scenario that produced a raw, repeating 409), this always
// attempts the write and reacts to SyncConflictError uniformly: refetch the
// real current state and reconcile against it.
async function pushDay(config: GitHubConfig, day: DayRecord, path: string): Promise<number> {
  const content = serializeDayDocument(day.markdown, day.metadata ?? emptyDayMetadata())
  try {
    const sha = await putFile(config, path, content, day.remoteSha)
    await markDaySynced(day.date, sha, day.localRevision, day.markdown, day.metadata)
    return 1
  } catch (error) {
    if (!(error instanceof SyncConflictError)) throw error

    const fresh = await getRemoteFile(config, path)
    if (!fresh) {
      // The file existed a moment ago (that's why we got a conflict) but is
      // gone now -- e.g. deleted upstream between our attempt and this
      // recovery fetch. A plain create is now correct.
      const sha = await putFile(config, path, content, undefined)
      await markDaySynced(day.date, sha, day.localRevision, day.markdown, day.metadata)
      return 1
    }
    const freshDocument = parseDayDocument(fresh.content)
    const hasUserMetadata = Object.values(day.metadata?.blocks ?? {}).some(
      (block) => Boolean(Object.keys(block.properties ?? {}).length || block.tags?.length),
    )
    if (fresh.content === content || (!hasUserMetadata && freshDocument.markdown === day.markdown)) {
      // Remote already matches what we were trying to write (e.g. another
      // tab in this same browser got there first) -- nothing left to push.
      await markDaySynced(day.date, fresh.sha, day.localRevision, day.markdown, day.metadata)
      return 1
    }

    // A genuine text divergence -- try a three-way merge against the last
    // content both sides agreed on before falling back to asking the user.
    // Most real divergences (edits to different parts of the day) resolve
    // here with zero interruption.
    const merged = mergeMarkdown(day.lastSyncedMarkdown ?? null, day.markdown, freshDocument.markdown)
    if (merged.conflicts.length === 0) {
      const mergedContent = serializeDayDocument(merged.markdown, day.metadata ?? emptyDayMetadata())
      const sha = await putFile(config, path, mergedContent, fresh.sha)
      await applyMergedDay(day.date, merged.markdown, day.metadata, sha, day.localRevision)
      return 1
    }

    await recordConflict('day', day.date, merged.markdown, merged.conflicts)
    throw new Error(`${path} changed in the data repository. Resolve the conflict to continue syncing.`, { cause: error })
  }
}

// Same recovery shape as pushDay: self-heal on an unchanged remote, three-
// way merge on a genuine divergence, and only fall back to a recorded
// conflict (resolved through the same Settings UI as day conflicts) when
// the merge actually finds overlapping edits.
async function pushThreadNote(config: GitHubConfig, note: ThreadNoteRecord, path: string): Promise<number> {
  try {
    const sha = await putFile(config, path, note.markdown, note.remoteSha)
    await markThreadNoteSynced(note.threadId, sha, note.localRevision, note.markdown)
    return 1
  } catch (error) {
    if (!(error instanceof SyncConflictError)) throw error

    const fresh = await getRemoteFile(config, path)
    if (!fresh) {
      const sha = await putFile(config, path, note.markdown, undefined)
      await markThreadNoteSynced(note.threadId, sha, note.localRevision, note.markdown)
      return 1
    }
    if (fresh.content === note.markdown) {
      await markThreadNoteSynced(note.threadId, fresh.sha, note.localRevision, note.markdown)
      return 1
    }

    const merged = mergeMarkdown(note.lastSyncedMarkdown ?? null, note.markdown, fresh.content)
    if (merged.conflicts.length === 0) {
      const sha = await putFile(config, path, merged.markdown, fresh.sha)
      await applyMergedThreadNote(note.threadId, merged.markdown, sha, note.localRevision)
      return 1
    }

    await recordConflict('thread-note', note.threadId, merged.markdown, merged.conflicts)
    throw new Error(`${path} changed in the data repository. Resolve the conflict to continue syncing.`, { cause: error })
  }
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
        // An unresolved conflict already describes this exact problem.
        // Retrying it every cycle would hammer the API and pile up a fresh
        // conflict row each time; wait for the user to resolve it instead.
        if (await hasOpenConflict('thread-note', note.threadId)) continue
        const path = `threads/${note.threadId}.md`
        synced += await pushThreadNote(config, note, path)
        continue
      }

      const day = await db.days.get(item.aggregateId)
      if (!day) {
        await db.outbox.delete(item.key)
        continue
      }

      if (await hasOpenConflict('day', day.date)) continue

      const year = day.date.slice(0, 4)
      const path = `days/${year}/${day.date}.md`
      synced += await pushDay(config, day, path)
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
  if (!day) return
  const localContent = serializeDayDocument(day.markdown, day.metadata ?? emptyDayMetadata())
  if (localContent === remote.content) return

  const freshDocument = parseDayDocument(remote.content)
  const merged = mergeMarkdown(day.lastSyncedMarkdown ?? null, day.markdown, freshDocument.markdown)
  if (merged.conflicts.length === 0) {
    // Auto-mergeable: adopt the merged text as a new local edit and leave it
    // queued in the outbox. remoteSha still won't match what that push sends
    // (remote only has its own half of the merge so far), but pushDay's own
    // SyncConflictError recovery handles that on the next cycle exactly like
    // any other divergence -- by which point local already contains remote's
    // side too, so that merge resolves cleanly.
    await saveDay(date, merged.markdown)
    return
  }
  await recordConflict('day', date, merged.markdown, merged.conflicts)
}

// Thread-note counterpart to pullDay. Thread notes were previously push-only:
// a browser only ever sent its own edits and never checked whether another
// device had pushed a newer version of a note it already had locally, so it
// could open the note editor on stale content. Same reconciliation shape as
// pullDay: no unsynced local edit -> the remote copy simply becomes the local
// one; a divergence -> three-way merge, and only a genuine overlapping-edit
// conflict falls back to a recorded conflict resolved through the same
// Settings UI.
export async function pullThreadNote(threadId: string): Promise<void> {
  const config = getGitHubConfig()
  if (!config) return

  const note = await db.threadNotes.get(threadId)
  const path = `threads/${threadId}.md`

  let remote: { content: string; sha: string } | null
  try {
    remote = await getRemoteFile(config, path)
  } catch {
    // Transient network/API failure -- don't disrupt the user over a
    // background refresh; the next trigger retries.
    return
  }
  if (!remote || remote.sha === note?.remoteSha) return

  const pendingLocalEdit = await db.outbox.get(`thread-note:${threadId}`)
  if (!pendingLocalEdit) {
    await applyRemoteThreadNote(threadId, remote.content, remote.sha)
    return
  }
  if (!note || note.markdown === remote.content) return

  const merged = mergeMarkdown(note.lastSyncedMarkdown ?? null, note.markdown, remote.content)
  if (merged.conflicts.length === 0) {
    // Adopt the merged text as a new local edit and leave it queued; pushThreadNote's
    // own SyncConflictError recovery reconciles the sha on the next cycle, by
    // which point local already contains remote's side too.
    await saveThreadNote(threadId, merged.markdown)
    return
  }
  await recordConflict('thread-note', threadId, merged.markdown, merged.conflicts)
}

// A conflict's merged draft can already be stale by the time the user
// resolves it (more commits may have landed since), so this re-fetches the
// file fresh rather than trusting the snapshot taken when the conflict was
// first detected. `choices` is either a single resolution applied to every
// open hunk (the "keep this browser's copy" / "keep the repository's copy"
// bulk buttons) or a per-hunk map from the focused resolution UI -- either
// way, hunks the merge already resolved automatically are left untouched.
export async function resolveConflict(
  conflictId: string,
  choices: 'local' | 'remote' | Map<number, 'local' | 'remote'>,
): Promise<void> {
  const conflict = await db.conflicts.get(conflictId)
  if (!conflict) return
  const config = getGitHubConfig()
  if (!config) throw new Error('Connect to GitHub before resolving a sync conflict.')

  const choiceMap = choices instanceof Map
    ? choices
    : new Map(conflict.conflicts.map((item) => [item.index, choices] as const))
  const resolvedMarkdown = applyConflictResolutions(conflict.mergedMarkdown, choiceMap)

  if (conflict.scope === 'day') {
    const year = conflict.aggregateId.slice(0, 4)
    const path = `days/${year}/${conflict.aggregateId}.md`
    const fresh = await getRemoteFile(config, path)
    const day = await db.days.get(conflict.aggregateId)
    const content = serializeDayDocument(resolvedMarkdown, day?.metadata ?? emptyDayMetadata())
    const sha = await putFile(config, path, content, fresh?.sha)
    await applyMergedDay(conflict.aggregateId, resolvedMarkdown, day?.metadata, sha, day?.localRevision ?? -1)
  } else {
    const path = `threads/${conflict.aggregateId}.md`
    const fresh = await getRemoteFile(config, path)
    const note = await db.threadNotes.get(conflict.aggregateId)
    const sha = await putFile(config, path, resolvedMarkdown, fresh?.sha)
    await applyMergedThreadNote(conflict.aggregateId, resolvedMarkdown, sha, note?.localRevision ?? -1)
  }

  await markConflictResolved(conflictId)
}
