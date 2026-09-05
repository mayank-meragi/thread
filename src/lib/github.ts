import { applyMergedDay, applyMergedThreadNote, applyRemoteDay, applyRemoteThreadNote, db, deleteRemoteDay, deleteRemoteThreadNote, hasOpenConflict, markConflictResolved, markDaySynced, markThreadNoteSynced, queueWorkspaceSync, recordConflict, saveDay, saveThreadNote, type DayRecord, type GitHubSyncState, type ThreadNoteRecord } from '../db'
import { emptyDayMetadata, parseDayDocument, serializeDayDocument } from './dayDocument'
import { applyConflictResolutions, mergeMarkdown } from './conflictMerge'
import { applyWorkspaceManifest, buildWorkspaceManifest, mergeWorkspaceManifests, parseWorkspaceManifest, serializeWorkspaceManifest, type WorkspaceManifestV1 } from './syncManifest'

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

export type PullResult = 'unchanged' | 'applied' | 'deleted' | 'conflicted' | 'failed'

export interface GitHubSyncProgress {
  phase: 'idle' | 'checking' | 'catching-up' | 'backing-off'
  processedFiles?: number
  totalFiles?: number
  lastCheckedAt?: string
  lastSuccessfulPullAt?: string
  retryAt?: string
}

const SYNC_STATE_EVENT = 'thread:github-sync-state'

function emitSyncProgress(progress: GitHubSyncProgress): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SYNC_STATE_EVENT, { detail: progress }))
}

function syncStateKey(config: GitHubConfig): string {
  return `${config.repo}@${config.branch}`
}

async function ensureSyncState(config: GitHubConfig): Promise<GitHubSyncState> {
  const key = syncStateKey(config)
  const existing = await db.syncStates.get(key)
  if (existing) return existing
  const created: GitHubSyncState = { key, repo: config.repo, branch: config.branch, baselineComplete: false, failureCount: 0 }
  await db.syncStates.put(created)
  return created
}

class GitHubRateLimitError extends Error {
  constructor(message: string, readonly retryAt: string) { super(message) }
}

function rateLimitError(response: Response): GitHubRateLimitError | null {
  if (response.status !== 403 && response.status !== 429) return null
  const retryAfter = Number(response.headers.get('retry-after'))
  const reset = Number(response.headers.get('x-ratelimit-reset'))
  const retryAt = Number.isFinite(retryAfter) && retryAfter > 0
    ? new Date(Date.now() + retryAfter * 1000).toISOString()
    : Number.isFinite(reset) && reset > 0
      ? new Date(reset * 1000).toISOString()
      : new Date(Date.now() + 60_000).toISOString()
  return new GitHubRateLimitError('GitHub asked Thread to pause syncing temporarily.', retryAt)
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

async function getRemoteFile(config: GitHubConfig, path: string, ref = config.branch): Promise<{ content: string; sha: string } | null> {
  const response = await fetch(
    `${API}/repos/${config.repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    { headers: headers(config.token) },
  )
  if (response.status === 404) return null
  const limited = rateLimitError(response)
  if (limited) throw limited
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
  const limited = rateLimitError(response)
  if (limited) throw limited
  if (!response.ok) throw new Error(`Could not sync ${path} (${response.status}).`)
  const result = (await response.json()) as { content: { sha: string } }
  return result.content.sha
}

async function pushWorkspace(config: GitHubConfig, outboxCreatedAt: string): Promise<number> {
  const state = await ensureSyncState(config)
  const local = await buildWorkspaceManifest()
  let remoteFile = await getRemoteFile(config, 'workspace.json')
  let merged = remoteFile
    ? mergeWorkspaceManifests(
      state.lastSyncedWorkspace as WorkspaceManifestV1 | undefined,
      local,
      parseWorkspaceManifest(remoteFile.content),
    )
    : local
  try {
    await putFile(config, 'workspace.json', serializeWorkspaceManifest(merged), remoteFile?.sha)
  } catch (error) {
    if (!(error instanceof SyncConflictError)) throw error
    remoteFile = await getRemoteFile(config, 'workspace.json')
    merged = remoteFile
      ? mergeWorkspaceManifests(state.lastSyncedWorkspace as WorkspaceManifestV1 | undefined, local, parseWorkspaceManifest(remoteFile.content))
      : local
    await putFile(config, 'workspace.json', serializeWorkspaceManifest(merged), remoteFile?.sha)
  }
  await applyWorkspaceManifest(merged)
  await db.syncStates.update(state.key, { lastSyncedWorkspace: merged })
  const current = await db.outbox.get('workspace')
  if (current?.createdAt === outboxCreatedAt) await db.outbox.delete('workspace')
  return 1
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
      if (item.kind === 'workspace') {
        synced += await pushWorkspace(config, item.createdAt)
        continue
      }
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
export async function pullDay(date: string, ref?: string, deleteIfMissing = false): Promise<PullResult> {
  const config = getGitHubConfig()
  if (!config) return 'unchanged'

  const day = await db.days.get(date)
  const year = date.slice(0, 4)
  const path = `days/${year}/${date}.md`

  let remote: { content: string; sha: string } | null
  try {
    remote = await getRemoteFile(config, path, ref)
  } catch {
    // Transient network/API failure -- don't disrupt the user over a
    // background refresh; the next scheduled pull retries.
    return 'failed'
  }
  if (!remote) {
    if (day && deleteIfMissing) {
      await deleteRemoteDay(date)
      return 'deleted'
    }
    return 'unchanged'
  }
  if (remote.sha === day?.remoteSha) return 'unchanged'

  const pendingLocalEdit = await db.outbox.get(`day:${date}`)
  if (!pendingLocalEdit) {
    await applyRemoteDay(date, remote.content, remote.sha)
    return 'applied'
  }
  if (!day) return 'unchanged'
  const localContent = serializeDayDocument(day.markdown, day.metadata ?? emptyDayMetadata())
  if (localContent === remote.content) return 'unchanged'

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
    return 'applied'
  }
  await recordConflict('day', date, merged.markdown, merged.conflicts)
  return 'conflicted'
}

// Thread-note counterpart to pullDay. Thread notes were previously push-only:
// a browser only ever sent its own edits and never checked whether another
// device had pushed a newer version of a note it already had locally, so it
// could open the note editor on stale content. Same reconciliation shape as
// pullDay: no unsynced local edit -> the remote copy simply becomes the local
// one; a divergence -> three-way merge, and only a genuine overlapping-edit
// conflict falls back to a recorded conflict resolved through the same
// Settings UI.
export async function pullThreadNote(threadId: string, ref?: string, deleteIfMissing = false): Promise<PullResult> {
  const config = getGitHubConfig()
  if (!config) return 'unchanged'

  const note = await db.threadNotes.get(threadId)
  const path = `threads/${threadId}.md`

  let remote: { content: string; sha: string } | null
  try {
    remote = await getRemoteFile(config, path, ref)
  } catch {
    // Transient network/API failure -- don't disrupt the user over a
    // background refresh; the next trigger retries.
    return 'failed'
  }
  if (!remote) {
    if (note && deleteIfMissing) {
      await deleteRemoteThreadNote(threadId)
      return 'deleted'
    }
    return 'unchanged'
  }
  if (remote.sha === note?.remoteSha) return 'unchanged'

  const pendingLocalEdit = await db.outbox.get(`thread-note:${threadId}`)
  if (!pendingLocalEdit) {
    await applyRemoteThreadNote(threadId, remote.content, remote.sha)
    return 'applied'
  }
  if (!note || note.markdown === remote.content) return 'unchanged'

  const merged = mergeMarkdown(note.lastSyncedMarkdown ?? null, note.markdown, remote.content)
  if (merged.conflicts.length === 0) {
    // Adopt the merged text as a new local edit and leave it queued; pushThreadNote's
    // own SyncConflictError recovery reconciles the sha on the next cycle, by
    // which point local already contains remote's side too.
    await saveThreadNote(threadId, merged.markdown)
    return 'applied'
  }
  await recordConflict('thread-note', threadId, merged.markdown, merged.conflicts)
  return 'conflicted'
}

interface RemoteTreeItem { path: string; type: 'blob' | 'tree'; sha: string }
interface ChangedFile { filename: string; previous_filename?: string; status: 'added' | 'modified' | 'removed' | 'renamed' | string }

function managedPath(path: string): boolean {
  return /^days\/\d{4}\/\d{4}-\d{2}-\d{2}\.md$/.test(path)
    || /^threads\/[^/]+\.md$/.test(path)
    || path === 'workspace.json'
}

function dayFromPath(path: string): string | null {
  return path.match(/^days\/\d{4}\/(\d{4}-\d{2}-\d{2})\.md$/)?.[1] ?? null
}

function threadFromPath(path: string): string | null {
  return path.match(/^threads\/([^/]+)\.md$/)?.[1] ?? null
}

async function getBranchHead(config: GitHubConfig, etag?: string): Promise<{ unchanged: boolean; sha?: string; etag?: string }> {
  const response = await fetch(`${API}/repos/${config.repo}/commits/${encodeURIComponent(config.branch)}`, {
    headers: { ...headers(config.token), ...(etag ? { 'If-None-Match': etag } : {}) },
  })
  if (response.status === 304) return { unchanged: true, etag: etag ?? response.headers.get('etag') ?? undefined }
  const limited = rateLimitError(response)
  if (limited) throw limited
  if (!response.ok) throw new Error(`Could not check GitHub branch (${response.status}).`)
  const body = await response.json() as { sha: string }
  return { unchanged: false, sha: body.sha, etag: response.headers.get('etag') ?? undefined }
}

async function getRemoteTree(config: GitHubConfig, headSha: string): Promise<RemoteTreeItem[]> {
  const response = await fetch(`${API}/repos/${config.repo}/git/trees/${headSha}?recursive=1`, { headers: headers(config.token) })
  const limited = rateLimitError(response)
  if (limited) throw limited
  if (!response.ok) throw new Error(`Could not list the data repository (${response.status}).`)
  const body = await response.json() as { tree: RemoteTreeItem[]; truncated?: boolean }
  if (body.truncated) throw new Error('GitHub returned a truncated repository tree; the data repository is too large to reconcile safely.')
  return body.tree.filter((item) => item.type === 'blob' && managedPath(item.path))
}

async function compareHeads(config: GitHubConfig, base: string, head: string): Promise<ChangedFile[] | null> {
  const basehead = encodeURIComponent(`${base}...${head}`)
  const response = await fetch(`${API}/repos/${config.repo}/compare/${basehead}?per_page=100&page=1`, { headers: headers(config.token) })
  if (response.status === 404 || response.status === 409) return null
  const limited = rateLimitError(response)
  if (limited) throw limited
  if (!response.ok) return null
  const body = await response.json() as { status?: string; files?: ChangedFile[]; total_commits?: number }
  if (body.status !== 'ahead' || !body.files || body.files.length >= 300) return null
  return body.files.filter((file) => managedPath(file.filename) || Boolean(file.previous_filename && managedPath(file.previous_filename)))
}

async function pullWorkspace(config: GitHubConfig, headSha: string): Promise<PullResult> {
  const remoteFile = await getRemoteFile(config, 'workspace.json', headSha)
  if (!remoteFile) {
    await queueWorkspaceSync()
    return 'unchanged'
  }
  const state = await ensureSyncState(config)
  const local = await buildWorkspaceManifest()
  const remote = parseWorkspaceManifest(remoteFile.content)
  const pendingLocalManifest = await db.outbox.get('workspace')
  const merged = !state.lastSyncedWorkspace && !pendingLocalManifest
    ? remote
    : mergeWorkspaceManifests(state.lastSyncedWorkspace as WorkspaceManifestV1 | undefined, local, remote)
  await applyWorkspaceManifest(merged)
  await db.syncStates.update(state.key, { lastSyncedWorkspace: remote })
  const normalized = await buildWorkspaceManifest()
  if (serializeWorkspaceManifest(normalized) !== serializeWorkspaceManifest(remote)) await queueWorkspaceSync()
  return 'applied'
}

async function applyRemotePath(config: GitHubConfig, path: string, headSha: string, deleted = false): Promise<PullResult> {
  const day = dayFromPath(path)
  if (day) {
    if (deleted) { await deleteRemoteDay(day); return 'deleted' }
    return pullDay(day, headSha)
  }
  const threadId = threadFromPath(path)
  if (threadId) {
    if (deleted) { await deleteRemoteThreadNote(threadId); return 'deleted' }
    return pullThreadNote(threadId, headSha)
  }
  if (path === 'workspace.json') {
    if (deleted) { await queueWorkspaceSync(); return 'deleted' }
    return pullWorkspace(config, headSha)
  }
  return 'unchanged'
}

export async function catchUpFromGitHub(options: { priorityPaths?: string[]; forceFull?: boolean } = {}): Promise<void> {
  const config = getGitHubConfig()
  if (!config) return
  const state = await ensureSyncState(config)
  if (state.retryAt && Date.parse(state.retryAt) > Date.now()) {
    emitSyncProgress({ phase: 'backing-off', retryAt: state.retryAt, lastCheckedAt: state.lastCheckedAt, lastSuccessfulPullAt: state.lastSuccessfulPullAt })
    return
  }
  emitSyncProgress({ phase: 'checking', lastCheckedAt: state.lastCheckedAt, lastSuccessfulPullAt: state.lastSuccessfulPullAt })
  try {
    const head = await getBranchHead(config, options.forceFull ? undefined : state.etag)
    const checkedAt = new Date().toISOString()
    if (head.unchanged && state.baselineComplete) {
      await db.syncStates.update(state.key, { lastCheckedAt: checkedAt, failureCount: 0, retryAt: undefined })
      emitSyncProgress({ phase: 'idle', lastCheckedAt: checkedAt, lastSuccessfulPullAt: state.lastSuccessfulPullAt })
      return
    }
    const headSha = head.sha ?? state.headSha
    if (!headSha) return
    const changes = !options.forceFull && state.baselineComplete && state.headSha
      ? await compareHeads(config, state.headSha, headSha)
      : null
    const forceFull = options.forceFull || !state.baselineComplete || changes === null
    let work: Array<{ path: string; deleted: boolean }>
    if (forceFull) {
      const tree = await getRemoteTree(config, headSha)
      const remotePaths = new Set(tree.map((item) => item.path))
      work = tree.map((item) => ({ path: item.path, deleted: false }))
      const [days, notes] = await Promise.all([db.days.toArray(), db.threadNotes.toArray()])
      for (const day of days) {
        const path = `days/${day.date.slice(0, 4)}/${day.date}.md`
        if (!remotePaths.has(path)) work.push({ path, deleted: true })
      }
      for (const note of notes) {
        const path = `threads/${note.threadId}.md`
        if (!remotePaths.has(path)) work.push({ path, deleted: true })
      }
      if (!remotePaths.has('workspace.json')) await queueWorkspaceSync()
    } else {
      work = []
      for (const change of changes ?? []) {
        work.push({ path: change.filename, deleted: change.status === 'removed' })
        if (change.status === 'renamed' && change.previous_filename && managedPath(change.previous_filename)) {
          work.push({ path: change.previous_filename, deleted: true })
        }
      }
    }
    const priorities = new Set(options.priorityPaths ?? [])
    work.sort((left, right) => Number(priorities.has(right.path)) - Number(priorities.has(left.path)))
    await db.syncStates.update(state.key, { totalFiles: work.length, processedFiles: 0, lastCheckedAt: checkedAt })
    emitSyncProgress({ phase: 'catching-up', processedFiles: 0, totalFiles: work.length, lastCheckedAt: checkedAt, lastSuccessfulPullAt: state.lastSuccessfulPullAt })
    for (let index = 0; index < work.length; index += 1) {
      const result = await applyRemotePath(config, work[index].path, headSha, work[index].deleted)
      if (result === 'failed') throw new Error(`Could not reconcile ${work[index].path}.`)
      await db.syncStates.update(state.key, { processedFiles: index + 1 })
      emitSyncProgress({ phase: 'catching-up', processedFiles: index + 1, totalFiles: work.length, lastCheckedAt: checkedAt, lastSuccessfulPullAt: state.lastSuccessfulPullAt })
    }
    const completedAt = new Date().toISOString()
    await db.syncStates.update(state.key, {
      headSha, etag: head.etag, baselineComplete: true, lastCheckedAt: checkedAt,
      lastSuccessfulPullAt: completedAt, retryAt: undefined, failureCount: 0,
      processedFiles: work.length, totalFiles: work.length,
    })
    emitSyncProgress({ phase: 'idle', lastCheckedAt: checkedAt, lastSuccessfulPullAt: completedAt })
  } catch (error) {
    const failureCount = state.failureCount + 1
    const retryAt = error instanceof GitHubRateLimitError
      ? error.retryAt
      : new Date(Date.now() + Math.min(60_000, 1000 * 2 ** failureCount)).toISOString()
    await db.syncStates.update(state.key, { retryAt, failureCount })
    emitSyncProgress({ phase: 'backing-off', retryAt, lastCheckedAt: state.lastCheckedAt, lastSuccessfulPullAt: state.lastSuccessfulPullAt })
    throw error
  }
}

let activeSyncCycle: Promise<void> | null = null
let rerunSyncCycle = false
let pendingForceFull = false
const pendingPriorityPaths = new Set<string>()

export function runGitHubSyncCycle(options: { priorityPaths?: string[]; forceFull?: boolean } = {}): Promise<void> {
  if (options.forceFull) pendingForceFull = true
  for (const path of options.priorityPaths ?? []) pendingPriorityPaths.add(path)
  if (activeSyncCycle) {
    rerunSyncCycle = true
    return activeSyncCycle
  }
  activeSyncCycle = (async () => {
    do {
      rerunSyncCycle = false
      const cycleOptions = { forceFull: pendingForceFull, priorityPaths: Array.from(pendingPriorityPaths) }
      pendingForceFull = false
      pendingPriorityPaths.clear()
      const config = getGitHubConfig()
      if (!config) return
      const state = await ensureSyncState(config)
      if (state.retryAt && Date.parse(state.retryAt) > Date.now()) {
        emitSyncProgress({ phase: 'backing-off', retryAt: state.retryAt, lastCheckedAt: state.lastCheckedAt, lastSuccessfulPullAt: state.lastSuccessfulPullAt })
        return
      }
      await syncPending()
      await catchUpFromGitHub(cycleOptions)
      await syncPending()
    } while (rerunSyncCycle)
  })().catch(async (error) => {
    const config = getGitHubConfig()
    if (config && error instanceof GitHubRateLimitError) {
      const state = await ensureSyncState(config)
      await db.syncStates.update(state.key, { retryAt: error.retryAt, failureCount: state.failureCount + 1 })
      emitSyncProgress({ phase: 'backing-off', retryAt: error.retryAt, lastCheckedAt: state.lastCheckedAt, lastSuccessfulPullAt: state.lastSuccessfulPullAt })
    }
    throw error
  }).finally(() => { activeSyncCycle = null })
  return activeSyncCycle
}

export { SYNC_STATE_EVENT }

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

// --- Editor image assets -----------------------------------------------------
//
// Images inserted in the editor are committed to the connected data repo under
// `assets/<sha256>.<ext>` (content-addressed: identical bytes always land at
// the same path, so re-uploading the same file is a no-op and there are no
// name collisions). The markdown stores just that relative path; the editor
// resolves it back to something an <img> can load via `resolveRepoAssetURL`.
// With no repo connected, `uploadRepoAsset` falls back to an inline data: URI
// so local-only notes still get images.

const assetURLCache = new Map<string, string>()

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image file.'))
    reader.readAsDataURL(file)
  })
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function assetExtension(file: File): string {
  const fromName = file.name.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase()
  if (fromName) return fromName
  const fromType = file.type.split('/')[1]?.toLowerCase()
  return fromType === 'jpeg' ? 'jpg' : fromType || 'bin'
}

function isAbsoluteAssetURL(src: string): boolean {
  return /^(https?:|data:|blob:)/i.test(src)
}

// Called by Crepe's ImageBlock `onUpload`. Returns the string stored as the
// image's markdown src.
export async function uploadRepoAsset(file: File): Promise<string> {
  const config = getGitHubConfig()
  if (!config) return fileToDataURL(file)

  const buffer = await file.arrayBuffer()
  const hash = await sha256Hex(buffer)
  const path = `assets/${hash}.${assetExtension(file)}`

  const existing = await fetch(
    `${API}/repos/${config.repo}/contents/${path}?ref=${encodeURIComponent(config.branch)}`,
    { headers: headers(config.token) },
  )
  if (existing.ok) return path
  if (existing.status !== 404) throw new Error(`Could not check ${path} (${existing.status}).`)

  const response = await fetch(`${API}/repos/${config.repo}/contents/${path}`, {
    method: 'PUT',
    headers: headers(config.token),
    body: JSON.stringify({
      message: `Add ${path}`,
      content: bytesToBase64(new Uint8Array(buffer)),
      branch: config.branch,
    }),
  })
  if (!response.ok) throw new Error(`Could not upload ${path} (${response.status}).`)
  return path
}

// Called by Crepe's ImageBlock `proxyDomURL`. Absolute URLs (external images,
// data: URIs from the offline fallback) pass straight through; a repo-relative
// path is fetched through the Contents API -- which carries the token, so it
// works for private repos where raw.githubusercontent.com would not -- and
// handed to the <img> as an object URL.
export function resolveRepoAssetURL(src: string): string | Promise<string> {
  if (!src || isAbsoluteAssetURL(src)) return src
  const cached = assetURLCache.get(src)
  if (cached) return cached

  const config = getGitHubConfig()
  if (!config) return src

  return (async () => {
    const response = await fetch(
      `${API}/repos/${config.repo}/contents/${src}?ref=${encodeURIComponent(config.branch)}`,
      { headers: { ...headers(config.token), Accept: 'application/vnd.github.raw' } },
    )
    if (!response.ok) throw new Error(`Could not load ${src} (${response.status}).`)
    const objectURL = URL.createObjectURL(await response.blob())
    assetURLCache.set(src, objectURL)
    return objectURL
  })()
}
