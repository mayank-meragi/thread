import Dexie, { type EntityTable } from 'dexie'
import { checklistCheckedPattern, checklistPrefixPattern } from './lib/blockKinds/definitions'
import { cleanMarkdownLine, countMarkdownBlocks, extractThreadMentions, parseOutline, type BlockKind, type OutlineBlock, type ParsedMention } from './lib/outline'
import { parseTaskDate } from './lib/taskDates'

export interface DayRecord {
  date: string
  markdown: string
  blockCount: number
  updatedAt: string
  localRevision: number
  remoteSha?: string
  lastSyncedAt?: string
}

export interface ThreadRecord {
  id: string
  title: string
  normalizedTitle: string
  createdAt: string
  updatedAt: string
}

export interface ThreadNoteRecord {
  threadId: string
  markdown: string
  blockCount: number
  updatedAt: string
  localRevision: number
  remoteSha?: string
  lastSyncedAt?: string
}

export interface MentionRecord {
  id: string
  threadId: string
  title: string
  day: string
  line: number
  blockId: string
  excerpt: string
  kind: BlockKind
  checked: boolean
}

export interface OutboxRecord {
  key: string
  kind: 'day' | 'thread-note'
  aggregateId: string
  createdAt: string
  attempts: number
  error?: string
}

export interface ConflictRecord {
  id: string
  day: string
  localMarkdown: string
  remoteMarkdown: string
  detectedAt: string
  resolvedAt?: string
}

export interface ThreadOccurrenceRecord {
  id: string
  threadId: string
  title: string
  day: string
  rootBlockId: string
  order: number
}

export interface ViewStateRecord {
  key: string
  view: string
  blockId: string
  collapsed: boolean
  updatedAt: string
}

export interface DayRevisionRecord extends DayRecord {
  id: string
  day: string
  archivedAt: string
}

export type TaskPriority = 'low' | 'medium' | 'high'

export interface TaskRecord {
  id: string
  blockId: string
  day: string
  line: number
  order: number
  text: string
  checked: boolean
  dueDate?: string
  dueText?: string
  dueSource?: 'nlp' | 'manual'
  priority?: TaskPriority
  completedAt?: string
  updatedAt: string
}

class ThreadDatabase extends Dexie {
  days!: EntityTable<DayRecord, 'date'>
  threads!: EntityTable<ThreadRecord, 'id'>
  mentions!: EntityTable<MentionRecord, 'id'>
  outbox!: EntityTable<OutboxRecord, 'key'>
  conflicts!: EntityTable<ConflictRecord, 'id'>
  blocks!: EntityTable<OutlineBlock, 'id'>
  occurrences!: EntityTable<ThreadOccurrenceRecord, 'id'>
  viewState!: EntityTable<ViewStateRecord, 'key'>
  revisions!: EntityTable<DayRevisionRecord, 'id'>
  tasks!: EntityTable<TaskRecord, 'id'>
  threadNotes!: EntityTable<ThreadNoteRecord, 'threadId'>

  constructor() {
    super('thread-v1')
    this.version(1).stores({
      days: 'date, updatedAt',
      threads: 'id, normalizedTitle, updatedAt',
      mentions: 'id, threadId, day, [threadId+day]',
      outbox: 'key, kind, aggregateId, createdAt',
      conflicts: 'id, day, detectedAt, resolvedAt',
    })
    this.version(2).stores({
      days: 'date, updatedAt',
      threads: 'id, normalizedTitle, updatedAt',
      mentions: 'id, threadId, day, [threadId+day]',
      outbox: 'key, kind, aggregateId, createdAt',
      conflicts: 'id, day, detectedAt, resolvedAt',
      blocks: 'id, day, parentId, [day+order]',
      occurrences: 'id, threadId, day, rootBlockId, [threadId+day]',
      viewState: 'key, view, blockId, collapsed',
    })
    this.version(3).stores({
      days: 'date, updatedAt',
      threads: 'id, normalizedTitle, updatedAt',
      mentions: 'id, threadId, day, [threadId+day]',
      outbox: 'key, kind, aggregateId, createdAt',
      conflicts: 'id, day, detectedAt, resolvedAt',
      blocks: 'id, day, parentId, [day+order]',
      occurrences: 'id, threadId, day, rootBlockId, [threadId+day]',
      viewState: 'key, view, blockId, collapsed',
      revisions: 'id, day, archivedAt, [day+localRevision]',
    })
    this.version(4).stores({
      days: 'date, updatedAt',
      threads: 'id, normalizedTitle, updatedAt',
      mentions: 'id, threadId, day, kind, [threadId+day]',
      outbox: 'key, kind, aggregateId, createdAt',
      conflicts: 'id, day, detectedAt, resolvedAt',
      blocks: 'id, day, parentId, kind, [day+order]',
      occurrences: 'id, threadId, day, rootBlockId, [threadId+day]',
      viewState: 'key, view, blockId, collapsed',
      revisions: 'id, day, archivedAt, [day+localRevision]',
      tasks: 'id, blockId, day, dueDate, priority, [day+order]',
    })
    this.version(5).stores({
      days: 'date, updatedAt',
      threads: 'id, normalizedTitle, updatedAt',
      mentions: 'id, threadId, day, kind, [threadId+day]',
      outbox: 'key, kind, aggregateId, createdAt',
      conflicts: 'id, day, detectedAt, resolvedAt',
      blocks: 'id, day, parentId, kind, [day+order]',
      occurrences: 'id, threadId, day, rootBlockId, [threadId+day]',
      viewState: 'key, view, blockId, collapsed',
      revisions: 'id, day, archivedAt, [day+localRevision]',
      tasks: 'id, blockId, day, dueDate, priority, [day+order]',
      threadNotes: 'threadId, updatedAt',
    })
  }
}

export const db = new ThreadDatabase()

const DEMO_MARKDOWN = `- Need to improve onboarding
  - simplify auth flow
  - talk to [[Rahul]]

- [[Browser]]
  - Start with **omnibox commands**
  - investigate Dia extension APIs

- IDEA: workout coach should account for today's activity

- [ ] Prototype omnibox for [[Browser]]
- DECISION: Start with an extension before building a browser. [[Browser]]`

export async function initializeDatabase(today: string): Promise<void> {
  await ensureDay(today)
  const days = await db.days.toArray()
  for (const day of days) await reindexDay(day)
  await pruneOrphanThreads()
}

export async function ensureDay(date: string): Promise<void> {
  const existing = await db.days.get(date)
  if (existing) {
    await reindexDay(existing)
    return
  }
  const hasAnyDay = (await db.days.count()) > 0
  const now = new Date().toISOString()
  await indexAndStoreDay({
    date,
    markdown: hasAnyDay ? '- ' : DEMO_MARKDOWN,
    blockCount: hasAnyDay ? 1 : countMarkdownBlocks(DEMO_MARKDOWN),
    updatedAt: now,
    localRevision: 1,
  })
}

export async function ensureThreadNote(threadId: string): Promise<void> {
  if (await db.threadNotes.get(threadId)) return
  await db.threadNotes.put({
    threadId,
    markdown: '- ',
    blockCount: 1,
    updatedAt: new Date().toISOString(),
    localRevision: 1,
  })
}

const threadNoteSaveQueues = new Map<string, Promise<void>>()

export function saveThreadNote(threadId: string, markdown: string): Promise<void> {
  const queued = threadNoteSaveQueues.get(threadId) ?? Promise.resolve()
  const next = queued.catch(() => undefined).then(async () => {
    const previous = await db.threadNotes.get(threadId)
    if (previous?.markdown === markdown) return
    const now = new Date().toISOString()
    await db.transaction('rw', [db.threadNotes, db.outbox], async () => {
      await db.threadNotes.put({
        threadId,
        markdown,
        blockCount: countMarkdownBlocks(markdown),
        updatedAt: now,
        localRevision: (previous?.localRevision ?? 0) + 1,
        remoteSha: previous?.remoteSha,
        lastSyncedAt: previous?.lastSyncedAt,
      })
      await db.outbox.put({
        key: `thread-note:${threadId}`,
        kind: 'thread-note',
        aggregateId: threadId,
        createdAt: now,
        attempts: 0,
      })
    })
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('thread:local-write'))
  })
  threadNoteSaveQueues.set(threadId, next)
  return next.finally(() => {
    if (threadNoteSaveQueues.get(threadId) === next) threadNoteSaveQueues.delete(threadId)
  })
}

async function indexAndStoreDay(record: DayRecord, previous?: DayRecord, options?: { queueOutbox?: boolean }): Promise<void> {
  const queueOutbox = options?.queueOutbox ?? true
  const outline = parseOutline(record.markdown, record.date)
  const parsed = withBlockIds(extractThreadMentions(record.markdown, record.date), outline.blocks)
  const taskRecords = await buildTaskRecords(outline.blocks, record.date)
  await db.transaction('rw', [db.days, db.threads, db.mentions, db.blocks, db.occurrences, db.outbox, db.revisions, db.tasks, db.threadNotes], async () => {
    if (previous && previous.markdown !== record.markdown) {
      await db.revisions.put({
        ...previous,
        id: `${previous.date}:${previous.localRevision}`,
        day: previous.date,
        archivedAt: new Date().toISOString(),
      })
    }
    await db.days.put(record)
    const previousMentions = await db.mentions.where('day').equals(record.date).toArray()
    await db.mentions.where('day').equals(record.date).delete()
    if (parsed.length) await db.mentions.bulkPut(parsed)
    await db.blocks.where('day').equals(record.date).delete()
    await db.occurrences.where('day').equals(record.date).delete()
    if (outline.blocks.length) await db.blocks.bulkPut(outline.blocks)
    if (outline.occurrences.length) await db.occurrences.bulkPut(outline.occurrences)
    await db.tasks.where('day').equals(record.date).delete()
    if (taskRecords.length) await db.tasks.bulkPut(taskRecords)

    const now = new Date().toISOString()
    for (const mention of parsed) {
      const existing = await db.threads.get(mention.threadId)
      await db.threads.put({
        id: mention.threadId,
        title: existing?.title ?? mention.title,
        normalizedTitle: mention.title.toLocaleLowerCase(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
    }
    for (const threadId of new Set(previousMentions.map((mention) => mention.threadId))) {
      await pruneThreadIfOrphan(threadId)
    }

    if (queueOutbox) {
      await db.outbox.put({
        key: `day:${record.date}`,
        kind: 'day',
        aggregateId: record.date,
        createdAt: now,
        attempts: 0,
      })
    }
  })
  if (queueOutbox && typeof window !== 'undefined') window.dispatchEvent(new Event('thread:local-write'))
}

async function reindexDay(record: DayRecord): Promise<void> {
  const outline = parseOutline(record.markdown, record.date)
  const parsed = withBlockIds(extractThreadMentions(record.markdown, record.date), outline.blocks)
  const taskRecords = await buildTaskRecords(outline.blocks, record.date)
  await db.transaction('rw', [db.threads, db.mentions, db.blocks, db.occurrences, db.tasks, db.threadNotes], async () => {
    const previousMentions = await db.mentions.where('day').equals(record.date).toArray()
    await db.mentions.where('day').equals(record.date).delete()
    if (parsed.length) await db.mentions.bulkPut(parsed)
    await db.blocks.where('day').equals(record.date).delete()
    await db.occurrences.where('day').equals(record.date).delete()
    if (outline.blocks.length) await db.blocks.bulkPut(outline.blocks)
    if (outline.occurrences.length) await db.occurrences.bulkPut(outline.occurrences)
    await db.tasks.where('day').equals(record.date).delete()
    if (taskRecords.length) await db.tasks.bulkPut(taskRecords)
    const now = new Date().toISOString()
    for (const mention of parsed) {
      const existing = await db.threads.get(mention.threadId)
      await db.threads.put({
        id: mention.threadId,
        title: existing?.title ?? mention.title,
        normalizedTitle: mention.title.toLocaleLowerCase(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
    }
    for (const threadId of new Set(previousMentions.map((mention) => mention.threadId))) {
      await pruneThreadIfOrphan(threadId)
    }
  })
}

function hasMeaningfulThreadNote(markdown: string): boolean {
  return markdown.split('\n').some((line) => cleanMarkdownLine(line).length > 0)
}

async function pruneThreadIfOrphan(threadId: string): Promise<void> {
  if (await db.mentions.where('threadId').equals(threadId).count()) return
  const note = await db.threadNotes.get(threadId)
  if (note && hasMeaningfulThreadNote(note.markdown)) return
  await db.threads.delete(threadId)
  if (note) await db.threadNotes.delete(threadId)
}

export async function pruneOrphanThreads(): Promise<void> {
  await db.transaction('rw', [db.threads, db.mentions, db.threadNotes], async () => {
    const threads = await db.threads.toArray()
    for (const thread of threads) await pruneThreadIfOrphan(thread.id)
  })
}

// extractThreadMentions's `line` and parseOutline's `order` are both the raw
// 0-based markdown line number for the same day (both iterate the identical
// `markdown.split('\n')` array) -- so a block's id can always be found by
// matching a mention's line against a block's order.
function withBlockIds(mentions: ParsedMention[], blocks: OutlineBlock[]): MentionRecord[] {
  const blockIdByOrder = new Map(blocks.map((block) => [block.order, block.id]))
  return mentions.map((mention) => ({ ...mention, blockId: blockIdByOrder.get(mention.line) ?? '' }))
}

async function buildTaskRecords(blocks: OutlineBlock[], day: string): Promise<TaskRecord[]> {
  const previous = new Map((await db.tasks.where('day').equals(day).toArray()).map((task) => [task.id, task]))
  const now = new Date().toISOString()
  return blocks.filter((block) => block.kind === 'task').map((block) => {
    const existing = previous.get(block.id)
    const detected = parseTaskDate(block.plainText, day)
    const manualDue = existing?.dueSource === 'manual'
    return {
      id: block.id,
      blockId: block.id,
      day,
      line: block.order,
      order: block.order,
      text: block.plainText,
      checked: block.checked,
      dueDate: manualDue ? existing.dueDate : detected?.dueDate,
      dueText: manualDue ? existing.dueText : detected?.matchedText,
      dueSource: manualDue ? 'manual' : detected ? 'nlp' : undefined,
      priority: existing?.priority,
      completedAt: block.checked ? existing?.completedAt ?? now : undefined,
      updatedAt: now,
    }
  })
}

export async function updateTaskMetadata(
  id: string,
  changes: { dueDate?: string; priority?: TaskPriority },
): Promise<void> {
  const task = await db.tasks.get(id)
  if (!task) return
  await db.tasks.update(id, {
    ...changes,
    ...(Object.prototype.hasOwnProperty.call(changes, 'dueDate') ? { dueSource: 'manual', dueText: undefined } : {}),
    updatedAt: new Date().toISOString(),
  })
}

export async function toggleTask(task: TaskRecord): Promise<void> {
  const day = await db.days.get(task.day)
  if (!day) return
  // Re-parse the day's current markdown and locate this task by its stable
  // block id, rather than trusting task.line (which can go stale between
  // when the TaskRecord was last indexed and when it's clicked) or falling
  // back to a text match, which silently toggles the wrong task whenever two
  // tasks share the same wording.
  const block = parseOutline(day.markdown, task.day).blocks.find((candidate) => candidate.id === task.id)
  if (!block || block.kind !== 'task') return
  const lines = day.markdown.split('\n')
  const line = lines[block.order]
  if (line === undefined) return
  lines[block.order] = block.checked
    ? line.replace(/^(\s*(?:[-*+]|\d+\.)\s+)\[[xX]\]/, '$1[ ]')
    : line.replace(/^(\s*(?:[-*+]|\d+\.)\s+)\[ \]/, '$1[x]')
  const markdown = lines.join('\n')
  await saveDay(task.day, markdown)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('thread:day-external-update', { detail: { day: task.day, markdown } }))
  }
}

export async function toggleTaskByBlockId(blockId: string): Promise<void> {
  const task = await db.tasks.get(blockId)
  if (task) await toggleTask(task)
}

export async function toggleChecklistBlock(day: string, blockId: string): Promise<void> {
  const record = await db.days.get(day)
  if (!record) return
  const block = parseOutline(record.markdown, day).blocks.find((candidate) => candidate.id === blockId)
  if (!block || block.kind !== 'checklist') return
  const lines = record.markdown.split('\n')
  const line = lines[block.order]
  if (line === undefined) return
  const listMarkerMatch = line.match(/^\s*(?:[-*+]|\d+\.)\s+/)
  if (!listMarkerMatch) return
  const content = line.slice(listMarkerMatch[0].length)
  const prefixMatch = content.match(checklistPrefixPattern)?.[0]
  if (!prefixMatch) return
  const replacement = checklistCheckedPattern.test(prefixMatch) ? '() ' : '(x) '
  lines[block.order] = listMarkerMatch[0] + replacement + content.slice(prefixMatch.length)
  const markdown = lines.join('\n')
  await saveDay(day, markdown)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('thread:day-external-update', { detail: { day, markdown } }))
  }
}

const saveQueues = new Map<string, Promise<void>>()

async function saveDayNow(date: string, markdown: string): Promise<void> {
  const previous = await db.days.get(date)
  if (previous?.markdown === markdown) return
  const now = new Date().toISOString()
  await indexAndStoreDay({
    date,
    markdown,
    blockCount: countMarkdownBlocks(markdown),
    updatedAt: now,
    localRevision: (previous?.localRevision ?? 0) + 1,
    remoteSha: previous?.remoteSha,
    lastSyncedAt: previous?.lastSyncedAt,
  }, previous)
}

export function saveDay(date: string, markdown: string): Promise<void> {
  const queued = saveQueues.get(date) ?? Promise.resolve()
  const next = queued.catch(() => undefined).then(() => saveDayNow(date, markdown))
  saveQueues.set(date, next)
  return next.finally(() => {
    if (saveQueues.get(date) === next) saveQueues.delete(date)
  })
}

// syncedRevision is the day's localRevision at the moment its content was
// read and pushed. A push can take real network time; if the user kept
// typing while it was in flight, a newer edit may have already re-queued the
// outbox entry with fresher content by the time this resolves. Deleting the
// outbox entry unconditionally would silently drop that newer edit from the
// sync queue -- it would never reach the remote until something else touched
// this day again. Only clear the pending marker if nothing changed since.
export async function markDaySynced(date: string, sha: string, syncedRevision: number): Promise<void> {
  await db.transaction('rw', db.days, db.outbox, async () => {
    const current = await db.days.get(date)
    await db.days.update(date, { remoteSha: sha, lastSyncedAt: new Date().toISOString() })
    if (current && current.localRevision === syncedRevision) {
      await db.outbox.delete(`day:${date}`)
    }
  })
}

export async function markThreadNoteSynced(threadId: string, sha: string, syncedRevision: number): Promise<void> {
  await db.transaction('rw', db.threadNotes, db.outbox, async () => {
    const current = await db.threadNotes.get(threadId)
    await db.threadNotes.update(threadId, { remoteSha: sha, lastSyncedAt: new Date().toISOString() })
    if (current && current.localRevision === syncedRevision) {
      await db.outbox.delete(`thread-note:${threadId}`)
    }
  })
}

// Records a day conflict, but only if one isn't already open for this day --
// otherwise a repeated pull/push against the same unresolved divergence would
// pile up a fresh row every cycle.
export async function recordDayConflict(date: string, localMarkdown: string, remoteMarkdown: string): Promise<void> {
  const existing = await db.conflicts.where('day').equals(date).filter((conflict) => !conflict.resolvedAt).first()
  if (existing) return
  await db.conflicts.put({
    id: `${date}:${Date.now()}`,
    day: date,
    localMarkdown,
    remoteMarkdown,
    detectedAt: new Date().toISOString(),
  })
}

export async function hasOpenDayConflict(date: string): Promise<boolean> {
  const existing = await db.conflicts.where('day').equals(date).filter((conflict) => !conflict.resolvedAt).first()
  return Boolean(existing)
}

// Applies a day's content as fetched from the remote repository. Unlike
// saveDay, this never queues an outbox entry -- there is nothing to push,
// since the content came from the remote in the first place.
export async function applyRemoteDay(date: string, markdown: string, sha: string): Promise<void> {
  const previous = await db.days.get(date)
  if (previous?.markdown === markdown) {
    await db.days.update(date, { remoteSha: sha, lastSyncedAt: new Date().toISOString() })
    return
  }
  const now = new Date().toISOString()
  await indexAndStoreDay({
    date,
    markdown,
    blockCount: countMarkdownBlocks(markdown),
    updatedAt: now,
    localRevision: (previous?.localRevision ?? 0) + 1,
    remoteSha: sha,
    lastSyncedAt: now,
  }, previous, { queueOutbox: false })
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('thread:day-external-update', { detail: { day: date, markdown } }))
}
export async function markConflictResolved(conflictId: string): Promise<void> {
  await db.conflicts.update(conflictId, { resolvedAt: new Date().toISOString() })
}
