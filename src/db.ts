import Dexie, { type EntityTable } from 'dexie'
import { checklistCheckedPattern, checklistPrefixPattern } from './lib/blockKinds/definitions'
import {
  BUILT_IN_PROPERTIES,
  reconcileBlockMetadata,
  type BlockPropertyRecord,
  type BlockTagRecord,
  type PropertyDefinitionRecord,
  type PropertySource,
  type PropertyType,
  type TagDefinitionRecord,
} from './lib/blockMetadata'
import { normalizePropertyValue, parseDayDocument, type DayMetadata, type PropertyValue } from './lib/dayDocument'
import { cleanMarkdownLine, countMarkdownBlocks, extractThreadMentions, insertPersonaNote, parseOutline, type BlockKind, type OutlineBlock, type ParsedMention } from './lib/outline'
import { parseTaskDate, type ParsedTaskDate } from './lib/taskDates'
import { extractHashtags, slugifyTag } from './lib/hashtags'
import { isoToday } from './lib/dates'

export interface DayRecord {
  date: string
  markdown: string
  metadata?: DayMetadata
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

export interface PersonaRecord {
  id: string
  name: string
  icon: string
  systemPrompt: string
  threadId: string
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

export interface ChatSessionRecord {
  id: string
  personaId: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface ChatMessageRecord {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export type TaskPriority = 'low' | 'medium' | 'high'
export type TaskStatus = 'not_started' | 'in_progress' | 'blocked' | 'done' | 'canceled'

export interface TaskRecord {
  id: string
  blockId: string
  day: string
  line: number
  order: number
  text: string
  description?: string
  checked: boolean
  status: TaskStatus
  statusSource: 'manual' | 'derived'
  parentTaskId?: string
  dueDate?: string
  startDate?: string
  dueText?: string
  dueSource?: 'nlp' | 'manual'
  priority?: TaskPriority
  estimatedMinutes?: number
  completedSubtasks: number
  totalSubtasks: number
  progress?: number
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
  propertyDefinitions!: EntityTable<PropertyDefinitionRecord, 'id'>
  blockProperties!: EntityTable<BlockPropertyRecord, 'id'>
  tagDefinitions!: EntityTable<TagDefinitionRecord, 'id'>
  blockTags!: EntityTable<BlockTagRecord, 'id'>
  personas!: EntityTable<PersonaRecord, 'id'>
  chatSessions!: EntityTable<ChatSessionRecord, 'id'>
  chatMessages!: EntityTable<ChatMessageRecord, 'id'>

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
    this.version(6).stores({
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
      propertyDefinitions: 'id, name, type, updatedAt',
      blockProperties: 'id, blockId, day, propertyId, [blockId+propertyId], [propertyId+day]',
      tagDefinitions: 'id, name, updatedAt',
      blockTags: 'id, blockId, day, tagId, [blockId+tagId], [tagId+day]',
    })
    this.version(7).stores({
      days: 'date, updatedAt',
      threads: 'id, normalizedTitle, updatedAt',
      mentions: 'id, threadId, day, kind, [threadId+day]',
      outbox: 'key, kind, aggregateId, createdAt',
      conflicts: 'id, day, detectedAt, resolvedAt',
      blocks: 'id, day, parentId, kind, [day+order]',
      occurrences: 'id, threadId, day, rootBlockId, [threadId+day]',
      viewState: 'key, view, blockId, collapsed',
      revisions: 'id, day, archivedAt, [day+localRevision]',
      tasks: 'id, blockId, day, status, parentTaskId, dueDate, startDate, priority, [day+order], [status+dueDate]',
      threadNotes: 'threadId, updatedAt',
      propertyDefinitions: 'id, name, type, updatedAt',
      blockProperties: 'id, blockId, day, propertyId, [blockId+propertyId], [propertyId+day]',
      tagDefinitions: 'id, name, updatedAt',
      blockTags: 'id, blockId, day, tagId, [blockId+tagId], [tagId+day]',
    })
    this.version(8).stores({
      days: 'date, updatedAt',
      threads: 'id, normalizedTitle, updatedAt',
      mentions: 'id, threadId, day, kind, [threadId+day]',
      outbox: 'key, kind, aggregateId, createdAt',
      conflicts: 'id, day, detectedAt, resolvedAt',
      blocks: 'id, day, parentId, kind, [day+order]',
      occurrences: 'id, threadId, day, rootBlockId, [threadId+day]',
      viewState: 'key, view, blockId, collapsed',
      revisions: 'id, day, archivedAt, [day+localRevision]',
      tasks: 'id, blockId, day, status, parentTaskId, dueDate, startDate, priority, [day+order], [status+dueDate]',
      threadNotes: 'threadId, updatedAt',
      propertyDefinitions: 'id, name, type, updatedAt',
      blockProperties: 'id, blockId, day, propertyId, [blockId+propertyId], [propertyId+day]',
      tagDefinitions: 'id, name, updatedAt',
      blockTags: 'id, blockId, day, tagId, [blockId+tagId], [tagId+day]',
      personas: 'id, updatedAt',
      chatSessions: 'id, personaId, updatedAt, [personaId+updatedAt]',
      chatMessages: 'id, sessionId, createdAt, [sessionId+createdAt]',
    })
    this.version(9).stores({
      days: 'date, updatedAt',
      threads: 'id, normalizedTitle, updatedAt',
      mentions: 'id, threadId, day, kind, [threadId+day]',
      outbox: 'key, kind, aggregateId, createdAt',
      conflicts: 'id, day, detectedAt, resolvedAt',
      blocks: 'id, day, parentId, kind, [day+order]',
      occurrences: 'id, threadId, day, rootBlockId, [threadId+day]',
      viewState: 'key, view, blockId, collapsed',
      revisions: 'id, day, archivedAt, [day+localRevision]',
      tasks: 'id, blockId, day, status, parentTaskId, dueDate, startDate, priority, [day+order], [status+dueDate]',
      threadNotes: 'threadId, updatedAt',
      propertyDefinitions: 'id, name, type, updatedAt',
      blockProperties: 'id, blockId, day, propertyId, [blockId+propertyId], [propertyId+day]',
      tagDefinitions: 'id, name, updatedAt',
      blockTags: 'id, blockId, day, tagId, [blockId+tagId], [tagId+day]',
      personas: 'id, threadId, updatedAt',
      chatSessions: 'id, personaId, updatedAt, [personaId+updatedAt]',
      chatMessages: 'id, sessionId, createdAt, [sessionId+createdAt]',
    })
  }
}

export const db = new ThreadDatabase()

// Writes a persona's note into today's journal under a `[[Persona]]` heading
// rather than into a separate per-thread scratchpad -- this way the note is
// dated the same way any other journal entry is, and it shows up in both the
// day view and the persona's thread (via the normal wiki-mention pipeline)
// with no separate rendering path to keep in sync.
export async function appendPersonaJournalNote(personaTitle: string, note: string): Promise<void> {
  const date = isoToday()
  await ensureDay(date)
  const day = await db.days.get(date)
  const markdown = insertPersonaNote(day?.markdown ?? '- ', personaTitle, note)
  await saveDay(date, markdown)
  // The chat panel writes this from outside whatever editor Today happens to
  // have open -- same situation as a remote sync pull -- so the open editor
  // needs the same nudge to pick up content it didn't type itself.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('thread:day-external-update', { detail: { day: date, markdown } }))
  }
}

export type { BlockPropertyRecord, BlockTagRecord, PropertyDefinitionRecord, PropertySource, PropertyType, PropertyValue, TagDefinitionRecord }

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
  await ensureBuiltInProperties()
  const days = await db.days.toArray()
  for (const day of days) {
    if (!day.metadata) await saveDay(day.date, day.markdown)
    else await reindexDay(day)
  }
  await pruneOrphanThreads()
  const { ensureGeneralPersona, repairPersonaThreads } = await import('./lib/personas')
  await ensureGeneralPersona()
  await repairPersonaThreads()
}

async function ensureBuiltInProperties(): Promise<void> {
  const now = new Date().toISOString()
  for (const definition of BUILT_IN_PROPERTIES) {
    const existing = await db.propertyDefinitions.get(definition.id)
    if (!existing) await db.propertyDefinitions.put({ ...definition, createdAt: now, updatedAt: now })
  }
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
  const positional = parseOutline(record.markdown, record.date)
  const reconciled = reconcileBlockMetadata(positional.blocks, record.metadata ?? previous?.metadata)
  const outline = parseOutline(record.markdown, record.date, reconciled.idsByPath)
  await syncInlineHashtags(outline.blocks, reconciled.metadata)
  record = { ...record, metadata: reconciled.metadata }
  const parsed = withBlockIds(extractThreadMentions(record.markdown, record.date), outline.blocks)
  const taskRecords = await buildTaskRecords(outline.blocks, record.date, reconciled.metadata)
  await db.transaction('rw', [db.days, db.threads, db.mentions, db.blocks, db.occurrences, db.outbox, db.revisions, db.tasks, db.threadNotes, db.blockProperties, db.blockTags, db.personas], async () => {
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
    await indexBlockMetadata(record.date, reconciled.metadata)

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
  const positional = parseOutline(record.markdown, record.date)
  const reconciled = reconcileBlockMetadata(positional.blocks, record.metadata)
  const outline = parseOutline(record.markdown, record.date, reconciled.idsByPath)
  await syncInlineHashtags(outline.blocks, reconciled.metadata)
  const parsed = withBlockIds(extractThreadMentions(record.markdown, record.date), outline.blocks)
  const taskRecords = await buildTaskRecords(outline.blocks, record.date, reconciled.metadata)
  await db.transaction('rw', [db.days, db.threads, db.mentions, db.blocks, db.occurrences, db.tasks, db.threadNotes, db.blockProperties, db.blockTags, db.personas], async () => {
    if (!record.metadata || JSON.stringify(record.metadata) !== JSON.stringify(reconciled.metadata)) {
      await db.days.update(record.date, { metadata: reconciled.metadata })
    }
    const previousMentions = await db.mentions.where('day').equals(record.date).toArray()
    await db.mentions.where('day').equals(record.date).delete()
    if (parsed.length) await db.mentions.bulkPut(parsed)
    await db.blocks.where('day').equals(record.date).delete()
    await db.occurrences.where('day').equals(record.date).delete()
    if (outline.blocks.length) await db.blocks.bulkPut(outline.blocks)
    if (outline.occurrences.length) await db.occurrences.bulkPut(outline.occurrences)
    await db.tasks.where('day').equals(record.date).delete()
    if (taskRecords.length) await db.tasks.bulkPut(taskRecords)
    await indexBlockMetadata(record.date, reconciled.metadata)
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

async function indexBlockMetadata(day: string, metadata: DayMetadata): Promise<void> {
  await db.blockProperties.where('day').equals(day).delete()
  await db.blockTags.where('day').equals(day).delete()
  const now = new Date().toISOString()
  const properties: BlockPropertyRecord[] = []
  const tags: BlockTagRecord[] = []
  for (const [blockId, item] of Object.entries(metadata.blocks)) {
    for (const [propertyId, value] of Object.entries(item.properties ?? {})) {
      properties.push({
        id: `${blockId}:${propertyId}`,
        blockId,
        day,
        propertyId,
        value,
        source: item.propertySources?.[propertyId]?.source ?? 'explicit',
        sourceTagId: item.propertySources?.[propertyId]?.sourceTagId,
        updatedAt: now,
      })
    }
    for (const tagId of item.tags ?? []) {
      tags.push({ id: `${blockId}:${tagId}`, blockId, day, tagId, source: item.tagSources?.[tagId] ?? 'explicit', updatedAt: now })
    }
  }
  if (properties.length) await db.blockProperties.bulkPut(properties)
  if (tags.length) await db.blockTags.bulkPut(tags)
}

async function syncInlineHashtags(blocks: OutlineBlock[], metadata: DayMetadata): Promise<void> {
  const namesBySlug = new Map<string, string>()
  for (const block of blocks) {
    for (const name of extractHashtags(block.markdown)) {
      const slug = slugifyTag(name)
      if (slug && !namesBySlug.has(slug)) namesBySlug.set(slug, name)
    }
  }

  const now = new Date().toISOString()
  const definitions = await db.tagDefinitions.toArray()
  const tagBySlug = new Map<string, TagDefinitionRecord>()
  for (const tag of definitions) {
    const slug = slugifyTag(tag.name)
    if (!tagBySlug.has(slug)) tagBySlug.set(slug, tag)
  }
  for (const [slug, name] of namesBySlug) {
    if (tagBySlug.has(slug)) continue
    let id = slug
    if (await db.tagDefinitions.get(id)) id = `${slug}-${crypto.randomUUID().slice(0, 6)}`
    const tag: TagDefinitionRecord = { id, name, propertyIds: [], createdAt: now, updatedAt: now }
    await db.tagDefinitions.put(tag)
    tagBySlug.set(slug, tag)
    definitions.push(tag)
  }

  const tagsById = new Map(definitions.map((tag) => [tag.id, tag]))
  const propertyDefinitions = new Map((await db.propertyDefinitions.toArray()).map((definition) => [definition.id, definition]))
  for (const block of blocks) {
    const item = metadata.blocks[block.id]
    if (!item) continue
    const desired = new Set(extractHashtags(block.markdown)
      .map((name) => tagBySlug.get(slugifyTag(name))?.id)
      .filter((id): id is string => Boolean(id)))
    const existing = new Set(item.tags ?? [])
    const inline = new Set(Object.entries(item.tagSources ?? {}).filter(([, source]) => source === 'inline').map(([tagId]) => tagId))

    for (const tagId of inline) {
      if (desired.has(tagId)) continue
      existing.delete(tagId)
      const tag = tagsById.get(tagId)
      if (tag) {
        const remaining = Array.from(existing).map((id) => tagsById.get(id)).filter((candidate): candidate is TagDefinitionRecord => Boolean(candidate))
        removeAutomatedTagProperties(item, tagId, tag.propertyIds, remaining, propertyDefinitions)
      }
      if (item.tagSources) delete item.tagSources[tagId]
    }

    for (const tagId of desired) {
      const tag = tagsById.get(tagId)
      if (!tag) continue
      if (!existing.has(tagId)) {
        existing.add(tagId)
        item.tagSources = { ...(item.tagSources ?? {}), [tagId]: 'inline' }
      }
      applyTagProperties(item, tag, propertyDefinitions)
    }

    if (existing.size) item.tags = Array.from(existing)
    else delete item.tags
    if (item.tagSources && Object.keys(item.tagSources).length === 0) delete item.tagSources
  }
}

function hasMeaningfulThreadNote(markdown: string): boolean {
  return markdown.split('\n').some((line) => cleanMarkdownLine(line).length > 0)
}

async function pruneThreadIfOrphan(threadId: string): Promise<void> {
  if (await db.mentions.where('threadId').equals(threadId).count()) return
  // Persona threads never get a `[[wiki-link]]` mention -- they're written to
  // directly by the AI's note-taking tool, not discovered through journal
  // text -- so the mention-count check alone would prune them the moment
  // they're created (before any note exists) and they'd never come back.
  if (await db.personas.where('threadId').equals(threadId).count()) return
  const note = await db.threadNotes.get(threadId)
  if (note && hasMeaningfulThreadNote(note.markdown)) return
  await db.threads.delete(threadId)
  if (note) await db.threadNotes.delete(threadId)
}

export async function pruneOrphanThreads(): Promise<void> {
  await db.transaction('rw', [db.threads, db.mentions, db.threadNotes, db.personas], async () => {
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

// The NLP date parser picks up phrases like "today"/"next friday" inline in
// the task text -- once that's captured as the due date, showing it again in
// the task label is redundant clutter, so cut just the matched span out.
function stripMatchedText(text: string, detected: ParsedTaskDate): string {
  const before = text.slice(0, detected.index)
  const after = text.slice(detected.index + detected.matchedText.length)
  return `${before}${after}`.replace(/\s{2,}/g, ' ').trim()
}

async function buildTaskRecords(blocks: OutlineBlock[], day: string, metadata?: DayMetadata): Promise<TaskRecord[]> {
  const previousTasks = await db.tasks.where('day').equals(day).toArray()
  const previous = new Map(previousTasks.map((task) => [task.id, task]))
  const previousByOrder = new Map(previousTasks.map((task) => [task.order, task]))
  const now = new Date().toISOString()
  const blockById = new Map(blocks.map((block) => [block.id, block]))
  const taskIds = new Set(blocks.filter((block) => block.kind === 'task').map((block) => block.id))
  const tasks: TaskRecord[] = blocks.filter((block) => block.kind === 'task').map((block): TaskRecord => {
    const existing = previous.get(block.id) ?? previousByOrder.get(block.order)
    const properties = metadata?.blocks[block.id]?.properties
    const detected = parseTaskDate(block.plainText, day)
    const metadataDue = typeof properties?.['due-date'] === 'string' ? properties['due-date'] : undefined
    const metadataPriority = properties?.priority === 'low' || properties?.priority === 'medium' || properties?.priority === 'high'
      ? properties.priority
      : undefined
    const metadataStatus = isTaskStatus(properties?.status) ? properties.status : undefined
    const status: TaskStatus = metadataStatus ?? (block.checked ? 'done' : 'not_started')
    let parentId = block.parentId
    while (parentId && !taskIds.has(parentId)) parentId = blockById.get(parentId)?.parentId ?? null
    const manualDue = metadataDue !== undefined || existing?.dueSource === 'manual'
    const text = detected ? stripMatchedText(block.plainText, detected) : block.plainText
    return {
      id: block.id,
      blockId: block.id,
      day,
      line: block.order,
      order: block.order,
      text,
      description: typeof properties?.description === 'string' ? properties.description : undefined,
      checked: status === 'done',
      status,
      statusSource: properties?.['status-source'] === 'derived' ? 'derived' : 'manual',
      parentTaskId: parentId ?? undefined,
      dueDate: metadataDue ?? (manualDue ? existing?.dueDate : detected?.dueDate),
      startDate: typeof properties?.['start-date'] === 'string' ? properties['start-date'] : undefined,
      dueText: manualDue ? existing?.dueText : detected?.matchedText,
      dueSource: manualDue ? 'manual' : detected ? 'nlp' : undefined,
      priority: metadataPriority ?? existing?.priority,
      estimatedMinutes: typeof properties?.['estimate-minutes'] === 'number' ? properties['estimate-minutes'] : undefined,
      completedSubtasks: 0,
      totalSubtasks: 0,
      progress: undefined,
      completedAt: status === 'done' ? existing?.completedAt ?? now : undefined,
      updatedAt: now,
    }
  })
  const children = new Map<string, TaskRecord[]>()
  tasks.forEach((task) => {
    if (!task.parentTaskId) return
    const list = children.get(task.parentTaskId) ?? []
    list.push(task)
    children.set(task.parentTaskId, list)
  })
  const leaves = (task: TaskRecord, visiting = new Set<string>()): TaskRecord[] => {
    if (visiting.has(task.id)) return []
    const direct = children.get(task.id) ?? []
    if (!direct.length) return [task]
    const next = new Set(visiting).add(task.id)
    return direct.flatMap((child) => leaves(child, next))
  }
  tasks.forEach((task) => {
    const direct = children.get(task.id) ?? []
    if (!direct.length) return
    if (metadata?.blocks[task.id]?.properties?.['status-source'] !== 'manual') task.statusSource = 'derived'
    const actionable = leaves(task).filter((leaf) => leaf.status !== 'canceled')
    task.totalSubtasks = actionable.length
    task.completedSubtasks = actionable.filter((leaf) => leaf.status === 'done').length
    task.progress = actionable.length ? task.completedSubtasks / actionable.length : undefined
    if (task.statusSource === 'derived') {
      if (task.totalSubtasks > 0 && task.completedSubtasks === task.totalSubtasks) task.status = 'done'
      else if (actionable.some((leaf) => leaf.status !== 'not_started')) task.status = 'in_progress'
      else task.status = 'not_started'
      task.checked = task.status === 'done'
    }
  })
  return tasks
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return value === 'not_started' || value === 'in_progress' || value === 'blocked' || value === 'done' || value === 'canceled'
}

export async function updateTaskMetadata(
  id: string,
  changes: { dueDate?: string; priority?: TaskPriority },
): Promise<void> {
  if (Object.prototype.hasOwnProperty.call(changes, 'dueDate')) {
    if (changes.dueDate) await setBlockProperty(id, 'due-date', changes.dueDate)
    else await removeBlockProperty(id, 'due-date')
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'priority')) {
    if (changes.priority) await setBlockProperty(id, 'priority', changes.priority)
    else await removeBlockProperty(id, 'priority')
  }
}

export async function toggleTask(task: TaskRecord): Promise<void> {
  const day = await db.days.get(task.day)
  if (!day) return
  // Re-parse the day's current markdown and locate this task by its stable
  // block id, rather than trusting task.line (which can go stale between
  // when the TaskRecord was last indexed and when it's clicked) or falling
  // back to a text match, which silently toggles the wrong task whenever two
  // tasks share the same wording.
  const block = parseStoredOutline(day).blocks.find((candidate) => candidate.id === task.id)
  if (!block || block.kind !== 'task') return
  const lines = day.markdown.split('\n')
  const line = lines[block.order]
  if (line === undefined) return
  lines[block.order] = block.checked
    ? line.replace(/^(\s*(?:[-*+]|\d+\.)\s+)\[[xX]\]/, '$1[ ]')
    : line.replace(/^(\s*(?:[-*+]|\d+\.)\s+)\[ \]/, '$1[x]')
  const markdown = lines.join('\n')
  await saveDay(task.day, markdown)
  await setBlockProperty(task.id, 'status', block.checked ? 'not_started' : 'done')
  await setBlockProperty(task.id, 'status-source', 'manual')
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
  const block = parseStoredOutline(record).blocks.find((candidate) => candidate.id === blockId)
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

function queueDayWrite(date: string, operation: () => Promise<void>): Promise<void> {
  const queued = saveQueues.get(date) ?? Promise.resolve()
  const next = queued.catch(() => undefined).then(operation)
  saveQueues.set(date, next)
  return next.finally(() => {
    if (saveQueues.get(date) === next) saveQueues.delete(date)
  })
}

async function saveDayNow(date: string, markdown: string): Promise<void> {
  const previous = await db.days.get(date)
  if (previous?.markdown === markdown && previous.metadata) return
  const now = new Date().toISOString()
  await indexAndStoreDay({
    date,
    markdown,
    metadata: previous?.metadata,
    blockCount: countMarkdownBlocks(markdown),
    updatedAt: now,
    localRevision: (previous?.localRevision ?? 0) + 1,
    remoteSha: previous?.remoteSha,
    lastSyncedAt: previous?.lastSyncedAt,
  }, previous)
}

export function saveDay(date: string, markdown: string): Promise<void> {
  return queueDayWrite(date, () => saveDayNow(date, markdown))
}

function parseStoredOutline(day: DayRecord): ReturnType<typeof parseOutline> {
  const idsByPath = new Map(Object.entries(day.metadata?.blocks ?? {}).map(([id, item]) => [item.path, id]))
  return parseOutline(day.markdown, day.date, idsByPath)
}

function notifyBlockMetadata(day: string, blockId: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('thread:block-metadata-update', { detail: { day, blockId } }))
  }
}

async function mutateBlockMetadata(
  blockId: string,
  mutate: (metadata: NonNullable<DayRecord['metadata']>['blocks'][string]) => void,
): Promise<void> {
  const block = await db.blocks.get(blockId)
  if (!block) throw new Error('This block no longer exists.')
  await queueDayWrite(block.day, async () => {
    const day = await db.days.get(block.day)
    if (!day) throw new Error('The source day no longer exists.')
    const positional = parseOutline(day.markdown, day.date)
    const reconciled = reconcileBlockMetadata(positional.blocks, day.metadata)
    const item = reconciled.metadata.blocks[blockId]
    if (!item) throw new Error('This block could not be matched to its source.')
    mutate(item)
    const now = new Date().toISOString()
    await indexAndStoreDay({
      ...day,
      metadata: reconciled.metadata,
      updatedAt: now,
      localRevision: day.localRevision + 1,
    }, day)
  })
  notifyBlockMetadata(block.day, blockId)
}

export async function setBlockProperty(
  blockId: string,
  propertyId: string,
  rawValue: unknown,
  source: PropertySource = 'explicit',
): Promise<void> {
  let definition = await db.propertyDefinitions.get(propertyId)
  if (!definition) {
    const builtIn = BUILT_IN_PROPERTIES.find((item) => item.id === propertyId)
    if (builtIn) {
      const now = new Date().toISOString()
      definition = { ...builtIn, createdAt: now, updatedAt: now }
      await db.propertyDefinitions.put(definition)
    }
  }
  if (!definition) throw new Error('This property definition no longer exists.')
  const value = normalizePropertyValue(rawValue)
  validatePropertyValue(definition, value)
  await mutateBlockMetadata(blockId, (item) => {
    item.properties = { ...(item.properties ?? {}), [propertyId]: value }
    item.propertySources = { ...(item.propertySources ?? {}), [propertyId]: { source } }
  })
}

export async function removeBlockProperty(blockId: string, propertyId: string): Promise<void> {
  await mutateBlockMetadata(blockId, (item) => {
    if (!item.properties) return
    const properties = { ...item.properties }
    delete properties[propertyId]
    if (Object.keys(properties).length) item.properties = properties
    else delete item.properties
    if (item.propertySources) {
      const sources = { ...item.propertySources }
      delete sources[propertyId]
      if (Object.keys(sources).length) item.propertySources = sources
      else delete item.propertySources
    }
  })
}

function validatePropertyValue(definition: PropertyDefinitionRecord, value: PropertyValue): void {
  if (value === null) return
  if (definition.type === 'number' && typeof value !== 'number') throw new Error(`${definition.name} must be a number.`)
  if (definition.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${definition.name} must be true or false.`)
  if ((definition.type === 'multi_select' || definition.type === 'relation') && !Array.isArray(value)) {
    throw new Error(`${definition.name} must contain a list of values.`)
  }
  if (!['number', 'boolean', 'multi_select', 'relation'].includes(definition.type) && typeof value !== 'string') {
    throw new Error(`${definition.name} must be text.`)
  }
  if ((definition.type === 'select' || definition.type === 'status') && definition.options?.length) {
    if (typeof value !== 'string' || !definition.options.some((option) => option.id === value)) {
      throw new Error(`${definition.name} contains an unknown option.`)
    }
  }
}

function definitionId(name: string): string {
  const base = name.trim().toLocaleLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return base || `property-${Date.now()}`
}

export async function createPropertyDefinition(input: { name: string; type: PropertyType }): Promise<PropertyDefinitionRecord> {
  const now = new Date().toISOString()
  let id = definitionId(input.name)
  if (await db.propertyDefinitions.get(id)) id = `${id}-${crypto.randomUUID().slice(0, 6)}`
  const definition: PropertyDefinitionRecord = { id, name: input.name.trim(), type: input.type, createdAt: now, updatedAt: now }
  await db.propertyDefinitions.put(definition)
  return definition
}

export async function updatePropertyDefinition(
  id: string,
  changes: Partial<Pick<PropertyDefinitionRecord, 'name' | 'options' | 'required' | 'defaultValue'>>,
): Promise<void> {
  await db.propertyDefinitions.update(id, { ...changes, updatedAt: new Date().toISOString() })
}

export async function createTag(name: string): Promise<TagDefinitionRecord> {
  const now = new Date().toISOString()
  let id = definitionId(name)
  if (await db.tagDefinitions.get(id)) id = `${id}-${crypto.randomUUID().slice(0, 6)}`
  const tag: TagDefinitionRecord = { id, name: name.trim(), propertyIds: [], createdAt: now, updatedAt: now }
  await db.tagDefinitions.put(tag)
  return tag
}

function tagDefaultValue(
  tag: TagDefinitionRecord,
  propertyId: string,
  definitions: Map<string, PropertyDefinitionRecord>,
): PropertyValue | undefined {
  if (Object.prototype.hasOwnProperty.call(tag.propertyDefaults ?? {}, propertyId)) {
    return tag.propertyDefaults?.[propertyId]
  }
  return definitions.get(propertyId)?.defaultValue
}

function removeAutomatedTagProperties(
  item: NonNullable<DayRecord['metadata']>['blocks'][string],
  tagId: string,
  propertyIds: string[],
  remainingTags: TagDefinitionRecord[],
  definitions: Map<string, PropertyDefinitionRecord>,
): void {
  for (const propertyId of propertyIds) {
    const source = item.propertySources?.[propertyId]
    if (source?.source !== 'automation' || source.sourceTagId !== tagId) continue
    const fallback = remainingTags.find((tag) => tag.propertyIds.includes(propertyId))
    const fallbackValue = fallback ? tagDefaultValue(fallback, propertyId, definitions) : undefined
    if (fallback && fallbackValue !== undefined) {
      item.properties = { ...(item.properties ?? {}), [propertyId]: fallbackValue }
      item.propertySources = { ...(item.propertySources ?? {}), [propertyId]: { source: 'automation', sourceTagId: fallback.id } }
      continue
    }
    const properties = { ...(item.properties ?? {}) }
    const sources = { ...(item.propertySources ?? {}) }
    delete properties[propertyId]
    delete sources[propertyId]
    if (Object.keys(properties).length) item.properties = properties
    else delete item.properties
    if (Object.keys(sources).length) item.propertySources = sources
    else delete item.propertySources
  }
}

function applyTagProperties(
  item: NonNullable<DayRecord['metadata']>['blocks'][string],
  tag: TagDefinitionRecord,
  definitions: Map<string, PropertyDefinitionRecord>,
): void {
  for (const propertyId of tag.propertyIds) {
    const value = tagDefaultValue(tag, propertyId, definitions)
    const source = item.propertySources?.[propertyId]
    const canAutomate = item.properties?.[propertyId] === undefined
      || (source?.source === 'automation' && source.sourceTagId === tag.id)
    if (!canAutomate) continue
    if (value === undefined) {
      if (source?.source === 'automation' && source.sourceTagId === tag.id) {
        removeAutomatedTagProperties(item, tag.id, [propertyId], [], definitions)
      }
      continue
    }
    item.properties = { ...(item.properties ?? {}), [propertyId]: value }
    item.propertySources = { ...(item.propertySources ?? {}), [propertyId]: { source: 'automation', sourceTagId: tag.id } }
  }
}

export async function updateTagDefinition(
  id: string,
  changes: Partial<Pick<TagDefinitionRecord, 'name' | 'color' | 'propertyIds' | 'propertyDefaults' | 'requiredPropertyIds'>>,
): Promise<void> {
  const previous = await db.tagDefinitions.get(id)
  if (!previous) throw new Error('This tag no longer exists.')
  const definitions = new Map((await db.propertyDefinitions.toArray()).map((definition) => [definition.id, definition]))
  const propertyIds = Array.from(new Set(changes.propertyIds ?? previous.propertyIds)).filter((propertyId) => definitions.has(propertyId))
  const propertyDefaults: Record<string, PropertyValue> = {}
  for (const [propertyId, rawValue] of Object.entries(changes.propertyDefaults ?? previous.propertyDefaults ?? {})) {
    if (!propertyIds.includes(propertyId)) continue
    const definition = definitions.get(propertyId)!
    const value = normalizePropertyValue(rawValue)
    validatePropertyValue(definition, value)
    propertyDefaults[propertyId] = value
  }
  const requiredPropertyIds = Array.from(new Set(changes.requiredPropertyIds ?? previous.requiredPropertyIds ?? []))
    .filter((propertyId) => propertyIds.includes(propertyId))
  const next: TagDefinitionRecord = {
    ...previous,
    ...changes,
    name: (changes.name ?? previous.name).trim(),
    propertyIds,
    ...(Object.keys(propertyDefaults).length ? { propertyDefaults } : { propertyDefaults: undefined }),
    ...(requiredPropertyIds.length ? { requiredPropertyIds } : { requiredPropertyIds: undefined }),
    updatedAt: new Date().toISOString(),
  }
  if (!next.name) throw new Error('A schema needs a name.')
  await db.tagDefinitions.put(next)

  const applications = await db.blockTags.where('tagId').equals(id).toArray()
  const allTags = new Map((await db.tagDefinitions.toArray()).map((tag) => [tag.id, tag]))
  const removedPropertyIds = previous.propertyIds.filter((propertyId) => !next.propertyIds.includes(propertyId))
  for (const application of applications) {
    await mutateBlockMetadata(application.blockId, (item) => {
      const remainingTags = (item.tags ?? []).filter((tagId) => tagId !== id)
        .map((tagId) => allTags.get(tagId)).filter((tag): tag is TagDefinitionRecord => Boolean(tag))
      removeAutomatedTagProperties(item, id, removedPropertyIds, remainingTags, definitions)
      applyTagProperties(item, next, definitions)
    })
  }
}

export async function addBlockTag(blockId: string, tagId: string): Promise<void> {
  const tag = await db.tagDefinitions.get(tagId)
  if (!tag) throw new Error('This tag no longer exists.')
  const definitions = new Map((await db.propertyDefinitions.toArray()).map((definition) => [definition.id, definition]))
  await mutateBlockMetadata(blockId, (item) => {
    item.tags = Array.from(new Set([...(item.tags ?? []), tagId]))
    item.tagSources = { ...(item.tagSources ?? {}), [tagId]: 'explicit' }
    applyTagProperties(item, tag, definitions)
  })
}

export async function removeBlockTag(blockId: string, tagId: string): Promise<void> {
  const tag = await db.tagDefinitions.get(tagId)
  const definitions = new Map((await db.propertyDefinitions.toArray()).map((definition) => [definition.id, definition]))
  const allTags = new Map((await db.tagDefinitions.toArray()).map((definition) => [definition.id, definition]))
  await mutateBlockMetadata(blockId, (item) => {
    const tags = (item.tags ?? []).filter((candidate) => candidate !== tagId)
    if (tags.length) item.tags = tags
    else delete item.tags
    if (item.tagSources) {
      const sources = { ...item.tagSources }
      delete sources[tagId]
      if (Object.keys(sources).length) item.tagSources = sources
      else delete item.tagSources
    }
    if (tag) {
      const remainingTags = tags.map((remainingId) => allTags.get(remainingId)).filter((item): item is TagDefinitionRecord => Boolean(item))
      removeAutomatedTagProperties(item, tagId, tag.propertyIds, remainingTags, definitions)
    }
  })
}

export async function deleteTagDefinition(id: string): Promise<void> {
  const applications = await db.blockTags.where('tagId').equals(id).toArray()
  for (const application of applications) await removeBlockTag(application.blockId, id)
  await db.tagDefinitions.delete(id)
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
  const document = parseDayDocument(markdown)
  const previous = await db.days.get(date)
  if (previous?.markdown === document.markdown && JSON.stringify(previous.metadata) === JSON.stringify(document.metadata)) {
    await db.days.update(date, { remoteSha: sha, lastSyncedAt: new Date().toISOString() })
    return
  }
  const now = new Date().toISOString()
  await indexAndStoreDay({
    date,
    markdown: document.markdown,
    metadata: document.metadata,
    blockCount: countMarkdownBlocks(document.markdown),
    updatedAt: now,
    localRevision: (previous?.localRevision ?? 0) + 1,
    remoteSha: sha,
    lastSyncedAt: now,
  }, previous, { queueOutbox: false })
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('thread:day-external-update', { detail: { day: date, markdown: document.markdown } }))
}
export async function markConflictResolved(conflictId: string): Promise<void> {
  await db.conflicts.update(conflictId, { resolvedAt: new Date().toISOString() })
}
