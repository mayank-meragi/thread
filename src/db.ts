import Dexie, { type EntityTable } from 'dexie'
import { checklistCheckedPattern, checklistPrefixPattern } from './lib/blockKinds/definitions'
import {
  BUILT_IN_PROPERTIES,
  BUILT_IN_TAGS,
  reconcileBlockMetadata,
  type BlockPropertyRecord,
  type BlockTagRecord,
  type PropertyDefinitionRecord,
  type PropertySource,
  type PropertyType,
  type TagDefinitionRecord,
} from './lib/blockMetadata'
import { normalizePropertyValue, parseDayDocument, type DayMetadata, type PropertyValue } from './lib/dayDocument'
import { emptyThreadMetadata, hasThreadMetadataEnvelope, parseThreadDocument, serializeThreadDocument, type ThreadMetadata } from './lib/threadDocument'
import { LOCAL_MARKER, REMOTE_MARKER, SEPARATOR_MARKER, type MergeConflict } from './lib/conflictMerge'
import { cleanMarkdownLine, countMarkdownBlocks, extractThreadMentions, insertPersonaNote, parseOutline, slugifyThread, type BlockKind, type OutlineBlock, type ParsedMention } from './lib/outline'
import { parseTaskDate, stripMatchedText } from './lib/taskDates'
import { extractHashtags, slugifyTag } from './lib/hashtags'
import { isoToday } from './lib/dates'
import type { CommandRisk } from './lib/commands/types'
import type { CompiledThreadScript, PlanPreview, PlanTargetCapture } from './lib/threadscript/types'
import { isWorkoutSystemTag, WORKOUT_SYSTEM_TAGS } from './lib/workouts/systemTags'

export interface DayRecord {
  date: string
  markdown: string
  metadata?: DayMetadata
  blockCount: number
  updatedAt: string
  localRevision: number
  remoteSha?: string
  lastSyncedAt?: string
  // The markdown/metadata last confirmed in sync with remoteSha -- the
  // common ancestor a three-way merge needs. Absent for records that
  // predate this field, in which case a conflict has no known base and
  // falls back to whole-file resolution (see lib/conflictMerge.ts).
  lastSyncedMarkdown?: string
  lastSyncedMetadata?: DayMetadata
}

export interface ThreadRecord {
  id: string
  title: string
  normalizedTitle: string
  createdAt: string
  updatedAt: string
  // Set only for threads the user started directly (command panel / search
  // fallback) rather than via a `[[wiki-link]]` mention. Exempts the thread
  // from `pruneThreadIfOrphan` so an empty, freshly-created thread survives
  // the next app reload.
  origin?: 'manual'
  // A template is just a thread with this flag: it is authored in the normal
  // thread editor, kept out of the usual thread lists, exempt from orphan
  // pruning, and its note body + properties can be copied onto another thread
  // via `applyThreadTemplate`. Stored `undefined` (never `false`) when off.
  isTemplate?: boolean
}

export interface ThreadNoteRecord {
  threadId: string
  markdown: string
  // Structured thread-level properties, parsed out of the `<!-- thread-metadata -->`
  // envelope at the head of `markdown`. `markdown` still stores the full string
  // (envelope included) so sync stays byte-exact; this is the decoded view.
  metadata?: ThreadMetadata
  blockCount: number
  updatedAt: string
  localRevision: number
  remoteSha?: string
  lastSyncedAt?: string
  lastSyncedMarkdown?: string
  lastSyncedMetadata?: ThreadMetadata
}

// Derived index over `ThreadNoteRecord.metadata.properties` -- never the source
// of truth. Rebuilt wholesale by `reindexThreadNote` whenever a thread note's
// markdown changes (local edit or remote pull). `id` is `${threadId}:${propertyId}`.
export interface ThreadPropertyRecord {
  id: string
  threadId: string
  propertyId: string
  value: PropertyValue
  source: PropertySource
  sourceTagId?: string
  updatedAt: string
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
  scope: 'day' | 'thread-note'
  aggregateId: string
  mergedMarkdown: string
  conflicts: MergeConflict[]
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
  // For built-in personas whose prompt ships with the app: the seed version its
  // `systemPrompt` came from, so `ensure*Persona` can upgrade an untouched
  // prompt. `0` means the user has edited it -- never re-seed after that.
  systemPromptVersion?: number
}

export interface ChatSessionRecord {
  id: string
  personaId: string
  title: string
  createdAt: string
  updatedAt: string
}

// Assistant replies are stored as their ordered parts (text + tool-call, with
// the tool result inline) so an inline tool-call UI -- e.g. the ThreadScript
// proposal card -- survives a reload. Plain text messages stay a bare string.
export type ChatMessagePartRecord =
  | { type: 'text'; text: string }
  | {
      type: 'tool-call'
      toolCallId: string
      toolName: string
      args?: unknown
      argsText?: string
      result?: unknown
      isError?: boolean
      // assistant-ui approval gate. Present on a `proposeThreadScript` call that
      // is waiting on (or has resolved) the user's Confirm/Cancel decision.
      approval?: { id: string; approved?: boolean; reason?: string; resolution?: 'cancelled' | 'expired' }
    }

export interface ChatMessageRecord {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string | ChatMessagePartRecord[]
  createdAt: string
  // Set while an assistant turn is paused on an approval gate, so a reload
  // rehydrates the runtime back into its `requires-action` state.
  status?: { type: 'requires-action'; reason: 'tool-calls' }
}

export type ChatProposalStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled' | 'stale'

export interface ChatProposalReceipt {
  actionIndex: number
  capability: string
  status: 'completed' | 'failed'
  idempotencyKey: string
  output?: unknown
  error?: string
  at: string
}

// A ThreadScript proposal the AI drafted and previewed. It is inert until the
// user confirms it in trusted UI (see `dispatchApprovedProposal`); creating
// one performs no domain write. Persisted so the approval card and its
// outcome survive a reload.
export interface ChatProposalRecord {
  id: string
  sessionId: string
  personaId: string
  messageId?: string
  source: string
  sourceHash: string
  description?: string
  risk: CommandRisk
  status: ChatProposalStatus
  plan: CompiledThreadScript
  preview: PlanPreview
  capturedTargets: PlanTargetCapture[]
  expectedVersions: Record<string, string | number>
  receipts: ChatProposalReceipt[]
  error?: string
  createdAt: string
  updatedAt: string
  resolvedAt?: string
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
  threadProperties!: EntityTable<ThreadPropertyRecord, 'id'>
  propertyDefinitions!: EntityTable<PropertyDefinitionRecord, 'id'>
  blockProperties!: EntityTable<BlockPropertyRecord, 'id'>
  tagDefinitions!: EntityTable<TagDefinitionRecord, 'id'>
  blockTags!: EntityTable<BlockTagRecord, 'id'>
  personas!: EntityTable<PersonaRecord, 'id'>
  chatSessions!: EntityTable<ChatSessionRecord, 'id'>
  chatMessages!: EntityTable<ChatMessageRecord, 'id'>
  chatProposals!: EntityTable<ChatProposalRecord, 'id'>

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
    this.version(10).stores({
      days: 'date, updatedAt',
      threads: 'id, normalizedTitle, updatedAt',
      mentions: 'id, threadId, day, kind, [threadId+day]',
      outbox: 'key, kind, aggregateId, createdAt',
      conflicts: 'id, scope, aggregateId, detectedAt, resolvedAt',
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
    }).upgrade(async (tx) => {
      // Pre-diff3 conflicts had no scope/aggregateId and stored raw
      // local/remote blobs instead of a merged draft with per-hunk
      // conflicts. Wrap each as a single whole-document conflict so an
      // in-flight conflict isn't silently dropped by the migration.
      await tx.table('conflicts').toCollection().modify((record: Record<string, unknown>) => {
        if (record.scope) return
        const local = typeof record.localMarkdown === 'string' ? record.localMarkdown : ''
        const remote = typeof record.remoteMarkdown === 'string' ? record.remoteMarkdown : ''
        record.scope = 'day'
        record.aggregateId = record.day
        record.mergedMarkdown = local === remote
          ? local
          : [LOCAL_MARKER, local, SEPARATOR_MARKER, remote, REMOTE_MARKER].join('\n')
        record.conflicts = local === remote ? [] : [{ index: 0, blockLabel: 'the whole note', local, remote }]
        delete record.day
        delete record.localMarkdown
        delete record.remoteMarkdown
      })
    })
    this.version(11).stores({
      days: 'date, updatedAt',
      threads: 'id, normalizedTitle, updatedAt',
      mentions: 'id, threadId, day, kind, blockId, [threadId+day]',
      outbox: 'key, kind, aggregateId, createdAt',
      conflicts: 'id, scope, aggregateId, detectedAt, resolvedAt',
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
    this.version(12).stores({
      days: 'date, updatedAt',
      threads: 'id, normalizedTitle, updatedAt',
      mentions: 'id, threadId, day, kind, blockId, [threadId+day]',
      outbox: 'key, kind, aggregateId, createdAt',
      conflicts: 'id, scope, aggregateId, detectedAt, resolvedAt',
      blocks: 'id, day, parentId, kind, [day+order]',
      occurrences: 'id, threadId, day, rootBlockId, [threadId+day]',
      viewState: 'key, view, blockId, collapsed',
      revisions: 'id, day, archivedAt, [day+localRevision]',
      tasks: 'id, blockId, day, status, parentTaskId, dueDate, startDate, priority, [day+order], [status+dueDate]',
      threadNotes: 'threadId, updatedAt',
      threadProperties: 'id, threadId, propertyId, value, [threadId+propertyId], [propertyId+value]',
      propertyDefinitions: 'id, name, type, updatedAt',
      blockProperties: 'id, blockId, day, propertyId, [blockId+propertyId], [propertyId+day]',
      tagDefinitions: 'id, name, updatedAt',
      blockTags: 'id, blockId, day, tagId, [blockId+tagId], [tagId+day]',
      personas: 'id, threadId, updatedAt',
      chatSessions: 'id, personaId, updatedAt, [personaId+updatedAt]',
      chatMessages: 'id, sessionId, createdAt, [sessionId+createdAt]',
    })
    this.version(13).stores({
      days: 'date, updatedAt',
      threads: 'id, normalizedTitle, updatedAt',
      mentions: 'id, threadId, day, kind, blockId, [threadId+day]',
      outbox: 'key, kind, aggregateId, createdAt',
      conflicts: 'id, scope, aggregateId, detectedAt, resolvedAt',
      blocks: 'id, day, parentId, kind, [day+order]',
      occurrences: 'id, threadId, day, rootBlockId, [threadId+day]',
      viewState: 'key, view, blockId, collapsed',
      revisions: 'id, day, archivedAt, [day+localRevision]',
      tasks: 'id, blockId, day, status, parentTaskId, dueDate, startDate, priority, [day+order], [status+dueDate]',
      threadNotes: 'threadId, updatedAt',
      threadProperties: 'id, threadId, propertyId, value, [threadId+propertyId], [propertyId+value]',
      propertyDefinitions: 'id, name, type, updatedAt',
      blockProperties: 'id, blockId, day, propertyId, [blockId+propertyId], [propertyId+day]',
      tagDefinitions: 'id, name, updatedAt',
      blockTags: 'id, blockId, day, tagId, [blockId+tagId], [tagId+day]',
      personas: 'id, threadId, updatedAt',
      chatSessions: 'id, personaId, updatedAt, [personaId+updatedAt]',
      chatMessages: 'id, sessionId, createdAt, [sessionId+createdAt]',
      chatProposals: 'id, sessionId, messageId, status, createdAt, [sessionId+createdAt]',
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
  await ensureBuiltInProperties()
  await ensureBuiltInTags()
  await ensureDay(today)
  const days = await db.days.toArray()
  for (const day of days) {
    if (!day.metadata) await saveDay(day.date, day.markdown)
    else await reindexDay(day)
  }
  await pruneOrphanThreads()
  // Back-fill the threadProperties index from each note's envelope -- covers
  // the v12 upgrade and any note pulled in while this code wasn't running.
  for (const note of await db.threadNotes.toArray()) {
    const metadata = note.metadata ?? parseThreadDocument(note.markdown).metadata
    if (!note.metadata && metadata.properties && Object.keys(metadata.properties).length) {
      await db.threadNotes.update(note.threadId, { metadata })
    }
    await reindexThreadNote(note.threadId, metadata)
  }
  const { ensureGeneralPersona, ensureWorkoutCoachPersona, repairPersonaThreads } = await import('./lib/personas')
  await ensureGeneralPersona()
  await ensureWorkoutCoachPersona()
  await repairPersonaThreads()
}

async function ensureBuiltInProperties(): Promise<void> {
  const now = new Date().toISOString()
  for (const definition of BUILT_IN_PROPERTIES) {
    const existing = await db.propertyDefinitions.get(definition.id)
    if (!existing) await db.propertyDefinitions.put({ ...definition, createdAt: now, updatedAt: now })
  }
}

async function ensureBuiltInTags(): Promise<void> {
  const now = new Date().toISOString()
  for (const builtIn of BUILT_IN_TAGS) {
    const existing = await db.tagDefinitions.get(builtIn.id)
    if (!existing) {
      await db.tagDefinitions.put({ ...builtIn, createdAt: now, updatedAt: now })
      continue
    }
    const propertyIds = Array.from(new Set([...builtIn.propertyIds, ...existing.propertyIds]))
    const needsRepair = existing.name !== builtIn.name
      || propertyIds.length !== existing.propertyIds.length
      || propertyIds.some((propertyId, index) => propertyId !== existing.propertyIds[index])
    if (needsRepair) {
      await db.tagDefinitions.put({
        ...existing,
        name: builtIn.name,
        propertyIds,
        updatedAt: now,
      })
    }
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

// Create a thread directly (not via a `[[wiki-link]]`). The id is derived from
// the title exactly the way wiki-linked and persona threads derive theirs
// (`slugifyThread`), so typing `[[Same Title]]` later resolves to this thread
// instead of a lookalike. On a slug collision the existing thread is returned
// untouched.
export async function createThread(title: string): Promise<string> {
  const clean = title.trim()
  const id = slugifyThread(clean)
  if (!id) throw new Error('Thread needs a name')
  const now = new Date().toISOString()
  const existing = await db.threads.get(id)
  await db.threads.put({
    id,
    title: existing?.title ?? clean,
    normalizedTitle: existing?.normalizedTitle ?? clean.toLocaleLowerCase(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    origin: existing?.origin ?? 'manual',
  })
  await ensureThreadNote(id)
  return id
}

// Rename a thread's display title. The `id` (slug) is left untouched, so the
// URL, `[[wiki-links]]`, notes, properties and open tabs keep resolving --
// title/slug divergence is already an accepted state (persona renames, slug
// collisions above). Local-only: the `threads` table is not in the sync
// pipeline. The denormalised `title` on mentions/occurrences is refreshed for
// any future consumer's benefit; a later reindex of an old day may reset it to
// the wiki-link text, which is expected.
export async function renameThread(threadId: string, nextTitle: string): Promise<void> {
  const clean = nextTitle.trim()
  if (!clean) throw new Error('Thread needs a name')
  const existing = await db.threads.get(threadId)
  if (!existing || existing.title === clean) return
  const now = new Date().toISOString()
  await db.threads.update(threadId, {
    title: clean,
    normalizedTitle: clean.toLocaleLowerCase(),
    updatedAt: now,
  })
  await db.mentions.where('threadId').equals(threadId).modify({ title: clean })
  await db.occurrences.where('threadId').equals(threadId).modify({ title: clean })
}

const threadNoteSaveQueues = new Map<string, Promise<void>>()

// Rebuilds the `threadProperties` index for one thread from its decoded
// envelope. Mirrors `indexBlockMetadata` for day documents: wholesale
// delete + bulkPut, never an incremental patch, so the index can't drift.
async function reindexThreadNote(threadId: string, metadata: ThreadMetadata | undefined): Promise<void> {
  await db.threadProperties.where('threadId').equals(threadId).delete()
  const entries = Object.entries(metadata?.properties ?? {})
  if (!entries.length) return
  const now = new Date().toISOString()
  await db.threadProperties.bulkPut(entries.map(([propertyId, value]) => ({
    id: `${threadId}:${propertyId}`,
    threadId,
    propertyId,
    value,
    source: metadata?.propertySources?.[propertyId]?.source ?? 'explicit',
    sourceTagId: metadata?.propertySources?.[propertyId]?.sourceTagId,
    updatedAt: now,
  })))
}

// `markdown` may arrive either as body-only text (from the editor, which never
// sees the envelope) or as a full envelope+body string. When `explicitMetadata`
// is passed (the property mutators do), it is authoritative even when empty —
// otherwise a body-only write keeps whatever properties the note already had,
// and an envelope-bearing string carries its own.
export function saveThreadNote(threadId: string, markdown: string, explicitMetadata?: ThreadMetadata): Promise<void> {
  const queued = threadNoteSaveQueues.get(threadId) ?? Promise.resolve()
  const next = queued.catch(() => undefined).then(async () => {
    const previous = await db.threadNotes.get(threadId)
    const incoming = parseThreadDocument(markdown)
    const metadata = explicitMetadata
      ?? (hasThreadMetadataEnvelope(markdown)
        ? incoming.metadata
        : previous?.metadata ?? emptyThreadMetadata())
    const stored = serializeThreadDocument(incoming.markdown, metadata)
    if (previous?.markdown === stored) return
    const now = new Date().toISOString()
    await db.transaction('rw', [db.threadNotes, db.threadProperties, db.outbox], async () => {
      await db.threadNotes.put({
        threadId,
        markdown: stored,
        metadata,
        blockCount: countMarkdownBlocks(incoming.markdown),
        updatedAt: now,
        localRevision: (previous?.localRevision ?? 0) + 1,
        remoteSha: previous?.remoteSha,
        lastSyncedAt: previous?.lastSyncedAt,
        lastSyncedMarkdown: previous?.lastSyncedMarkdown,
        lastSyncedMetadata: previous?.lastSyncedMetadata,
      })
      await reindexThreadNote(threadId, metadata)
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

// Thread-level counterparts to setBlockProperty / removeBlockProperty. They
// funnel through saveThreadNote so there is exactly one write path (envelope
// serialization, outbox enqueue, index rebuild, local-write event).
export async function setThreadProperty(
  threadId: string,
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
  const note = await db.threadNotes.get(threadId)
  const body = note ? parseThreadDocument(note.markdown).markdown : '- '
  const metadata: ThreadMetadata = note?.metadata
    ? { ...note.metadata, properties: { ...note.metadata.properties }, propertySources: { ...note.metadata.propertySources } }
    : emptyThreadMetadata()
  metadata.properties[propertyId] = value
  metadata.propertySources = { ...metadata.propertySources, [propertyId]: { source } }
  await saveThreadNote(threadId, body, metadata)
}

export async function removeThreadProperty(threadId: string, propertyId: string): Promise<void> {
  const note = await db.threadNotes.get(threadId)
  if (!note?.metadata) return
  const body = parseThreadDocument(note.markdown).markdown
  const properties = { ...note.metadata.properties }
  delete properties[propertyId]
  const propertySources = { ...note.metadata.propertySources }
  delete propertySources[propertyId]
  const metadata: ThreadMetadata = { ...note.metadata, properties }
  if (Object.keys(propertySources).length) metadata.propertySources = propertySources
  else delete metadata.propertySources
  await saveThreadNote(threadId, body, metadata)
}

// --- Thread templates -------------------------------------------------------
// A template is just a thread with `isTemplate` set. It is authored in the
// normal thread editor; these helpers only toggle the flag and copy one
// template thread's body + properties onto another thread.

export async function setThreadIsTemplate(threadId: string, value: boolean): Promise<void> {
  await db.threads.update(threadId, {
    isTemplate: value || undefined,
    updatedAt: new Date().toISOString(),
  })
}

// Drop a template thread onto another thread: seed/append its note body, then
// copy any properties it carries (never clobbering a value the target already
// has set explicitly). Tags are merged into the note envelope for
// forward-compat only.
export async function applyThreadTemplate(targetThreadId: string, templateThreadId: string): Promise<void> {
  const templateNote = await db.threadNotes.get(templateThreadId)
  if (!templateNote) throw new Error('This template no longer exists.')
  const source = parseThreadDocument(templateNote.markdown)
  const templateBody = source.markdown.trim()

  await ensureThreadNote(targetThreadId)
  const note = await db.threadNotes.get(targetThreadId)
  const currentBody = note ? parseThreadDocument(note.markdown).markdown : '- '
  const templateTags = source.metadata.tags ?? []

  if (templateBody) {
    const isEmpty = currentBody.trim() === '' || currentBody.trim() === '-'
    const nextBody = isEmpty ? templateBody : `${currentBody.replace(/\s+$/, '')}\n\n${templateBody}`
    if (templateTags.length) {
      const existingMeta = note?.metadata ?? emptyThreadMetadata()
      const tags = Array.from(new Set([...(existingMeta.tags ?? []), ...templateTags]))
      await saveThreadNote(targetThreadId, nextBody, { ...existingMeta, tags })
    } else {
      await saveThreadNote(targetThreadId, nextBody)
    }
  } else if (templateTags.length) {
    const existingMeta = note?.metadata ?? emptyThreadMetadata()
    const tags = Array.from(new Set([...(existingMeta.tags ?? []), ...templateTags]))
    await saveThreadNote(targetThreadId, currentBody, { ...existingMeta, tags })
  }

  // Best-effort: a single property whose value no longer validates (a renamed
  // select option, a deleted definition) must not stop the rest from applying.
  const failed: string[] = []
  for (const [propertyId, value] of Object.entries(source.metadata.properties)) {
    const existing = await db.threadProperties.get(`${targetThreadId}:${propertyId}`)
    if (existing?.source === 'explicit') continue
    try {
      await setThreadProperty(targetThreadId, propertyId, value, 'explicit')
    } catch {
      failed.push(propertyId)
    }
  }
  if (failed.length) throw new Error(`Some template properties could not be applied: ${failed.join(', ')}`)
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
  // Reserved workout names always resolve to their protected stable IDs,
  // even when an older user-created tag has the same display name.
  for (const tagId of Object.values(WORKOUT_SYSTEM_TAGS)) {
    const tag = definitions.find((candidate) => candidate.id === tagId)
    if (tag) tagBySlug.set(slugifyTag(tag.name), tag)
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
    const desiredIds = extractHashtags(block.markdown)
      .map((name) => tagBySlug.get(slugifyTag(name))?.id)
      .filter((id): id is string => Boolean(id))
    const lastStructuralId = desiredIds.filter((id) => isWorkoutSystemTag(id)).at(-1)
    const desired = new Set(desiredIds.filter((id) => !isWorkoutSystemTag(id) || id === lastStructuralId))
    const existing = new Set(item.tags ?? [])
    const inline = new Set(Object.entries(item.tagSources ?? {}).filter(([, source]) => source === 'inline').map(([tagId]) => tagId))

    if (lastStructuralId) {
      for (const tagId of Array.from(existing)) {
        if (tagId === lastStructuralId || !isWorkoutSystemTag(tagId)) continue
        existing.delete(tagId)
        const tag = tagsById.get(tagId)
        if (tag) {
          const remaining = Array.from(existing).map((id) => tagsById.get(id)).filter((candidate): candidate is TagDefinitionRecord => Boolean(candidate))
          removeAutomatedTagProperties(item, tagId, tag.propertyIds, remaining, propertyDefinitions)
        }
        if (item.tagSources) delete item.tagSources[tagId]
      }
    }

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
  // Threads the user started directly, or marked as a template, are kept even
  // while empty -- they were shaped deliberately, not discovered from journal
  // text.
  const thread = await db.threads.get(threadId)
  if (thread?.origin === 'manual' || thread?.isTemplate) return
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
    lastSyncedMarkdown: previous?.lastSyncedMarkdown,
    lastSyncedMetadata: previous?.lastSyncedMetadata,
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

export function validatePropertyValue(definition: PropertyDefinitionRecord, value: PropertyValue): void {
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
  if (isWorkoutSystemTag(id) && changes.name !== undefined && changes.name.trim() !== previous.name) {
    throw new Error('Built-in workout tags cannot be renamed.')
  }
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

async function ensureBlockUsesTaskSyntax(blockId: string): Promise<void> {
  const block = await db.blocks.get(blockId)
  if (!block || block.kind === 'task') return
  const day = await db.days.get(block.day)
  if (!day) throw new Error('The source day no longer exists.')
  const lines = day.markdown.split('\n')
  const line = lines[block.order]
  if (line === undefined) throw new Error('The source block could not be found.')
  const item = line.match(/^(\s*(?:[-*+]|\d+\.)\s+)(.*)$/)
  lines[block.order] = item ? `${item[1]}[ ] ${item[2]}` : `- [ ] ${line.trim()}`
  await saveDay(block.day, lines.join('\n'))
}

export async function addBlockTag(blockId: string, tagId: string): Promise<void> {
  const tag = await db.tagDefinitions.get(tagId)
  if (!tag) throw new Error('This tag no longer exists.')
  if (isWorkoutSystemTag(tagId)) await ensureBlockUsesTaskSyntax(blockId)
  const definitions = new Map((await db.propertyDefinitions.toArray()).map((definition) => [definition.id, definition]))
  const allTags = new Map((await db.tagDefinitions.toArray()).map((definition) => [definition.id, definition]))
  await mutateBlockMetadata(blockId, (item) => {
    let tags = item.tags ?? []
    if (isWorkoutSystemTag(tagId)) {
      for (const existingTagId of tags) {
        if (existingTagId === tagId || !isWorkoutSystemTag(existingTagId)) continue
        const existingTag = allTags.get(existingTagId)
        if (existingTag) {
          const remaining = tags
            .filter((candidate) => candidate !== existingTagId)
            .map((candidate) => allTags.get(candidate))
            .filter((candidate): candidate is TagDefinitionRecord => Boolean(candidate))
          removeAutomatedTagProperties(item, existingTagId, existingTag.propertyIds, remaining, definitions)
        }
        if (item.tagSources) delete item.tagSources[existingTagId]
      }
      tags = tags.filter((candidate) => !isWorkoutSystemTag(candidate) || candidate === tagId)
    }
    item.tags = Array.from(new Set([...tags, tagId]))
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
  if (isWorkoutSystemTag(id)) throw new Error('Built-in workout tags cannot be deleted.')
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
// `markdown`/`metadata` are the content that was actually pushed (the merge
// base for the next conflict, if any) -- distinct from `current.markdown`,
// which may have moved on if the user kept typing while the push was in
// flight.
export async function markDaySynced(date: string, sha: string, syncedRevision: number, markdown: string, metadata?: DayMetadata): Promise<void> {
  await db.transaction('rw', db.days, db.outbox, async () => {
    const current = await db.days.get(date)
    await db.days.update(date, {
      remoteSha: sha,
      lastSyncedAt: new Date().toISOString(),
      lastSyncedMarkdown: markdown,
      lastSyncedMetadata: metadata,
    })
    if (current && current.localRevision === syncedRevision) {
      await db.outbox.delete(`day:${date}`)
    }
  })
}

// Thread-note counterpart to applyMergedDay: `markdown` is what's now
// actually on the remote, so this both adopts it locally (unless a newer
// local edit is in flight, in which case only the new remote baseline is
// recorded) and clears the outbox entry rather than re-queuing it.
export async function applyMergedThreadNote(threadId: string, markdown: string, sha: string, syncedRevision: number): Promise<void> {
  const mergedMetadata = parseThreadDocument(markdown).metadata
  await db.transaction('rw', db.threadNotes, db.threadProperties, db.outbox, async () => {
    const current = await db.threadNotes.get(threadId)
    if (!current) return
    const now = new Date().toISOString()
    if (current.localRevision !== syncedRevision) {
      await db.threadNotes.update(threadId, { remoteSha: sha, lastSyncedAt: now, lastSyncedMarkdown: markdown, lastSyncedMetadata: mergedMetadata })
      return
    }
    await db.threadNotes.update(threadId, {
      markdown,
      metadata: mergedMetadata,
      blockCount: countMarkdownBlocks(parseThreadDocument(markdown).markdown),
      updatedAt: now,
      localRevision: current.localRevision + 1,
      remoteSha: sha,
      lastSyncedAt: now,
      lastSyncedMarkdown: markdown,
      lastSyncedMetadata: mergedMetadata,
    })
    await reindexThreadNote(threadId, mergedMetadata)
    await db.outbox.delete(`thread-note:${threadId}`)
  })
}

export async function markThreadNoteSynced(threadId: string, sha: string, syncedRevision: number, markdown: string): Promise<void> {
  await db.transaction('rw', db.threadNotes, db.outbox, async () => {
    const current = await db.threadNotes.get(threadId)
    await db.threadNotes.update(threadId, {
      remoteSha: sha,
      lastSyncedAt: new Date().toISOString(),
      lastSyncedMarkdown: markdown,
      lastSyncedMetadata: parseThreadDocument(markdown).metadata,
    })
    if (current && current.localRevision === syncedRevision) {
      await db.outbox.delete(`thread-note:${threadId}`)
    }
  })
}

// Records a sync conflict, but only if one isn't already open for this
// day/thread-note -- otherwise a repeated pull/push against the same
// unresolved divergence would pile up a fresh row every cycle.
export async function recordConflict(
  scope: 'day' | 'thread-note',
  aggregateId: string,
  mergedMarkdown: string,
  conflicts: MergeConflict[],
): Promise<void> {
  const existing = await db.conflicts
    .where('aggregateId').equals(aggregateId)
    .filter((conflict) => conflict.scope === scope && !conflict.resolvedAt)
    .first()
  if (existing) return
  await db.conflicts.put({
    id: `${scope}:${aggregateId}:${Date.now()}`,
    scope,
    aggregateId,
    mergedMarkdown,
    conflicts,
    detectedAt: new Date().toISOString(),
  })
}

export async function hasOpenConflict(scope: 'day' | 'thread-note', aggregateId: string): Promise<boolean> {
  const existing = await db.conflicts
    .where('aggregateId').equals(aggregateId)
    .filter((conflict) => conflict.scope === scope && !conflict.resolvedAt)
    .first()
  return Boolean(existing)
}

// Applies a day's content after a successful auto-merged push: `markdown` is
// what's now actually on the remote at `sha` (local content merged with
// whatever changed remotely), so -- unlike a plain local edit -- this is
// already fully synced and clears the outbox entry rather than re-queuing
// it. If a newer local edit landed while the merge/push was in flight
// (localRevision has moved past `syncedRevision`), that edit is left alone;
// only the new remote baseline is recorded, and the next sync cycle merges
// the newer edit against it.
export async function applyMergedDay(
  date: string,
  markdown: string,
  metadata: DayMetadata | undefined,
  sha: string,
  syncedRevision: number,
): Promise<void> {
  const previous = await db.days.get(date)
  if (!previous) return
  const now = new Date().toISOString()
  if (previous.localRevision !== syncedRevision) {
    await db.days.update(date, {
      remoteSha: sha,
      lastSyncedAt: now,
      lastSyncedMarkdown: markdown,
      lastSyncedMetadata: metadata,
    })
    return
  }
  await indexAndStoreDay({
    ...previous,
    markdown,
    metadata,
    blockCount: countMarkdownBlocks(markdown),
    updatedAt: now,
    localRevision: previous.localRevision + 1,
    remoteSha: sha,
    lastSyncedAt: now,
    lastSyncedMarkdown: markdown,
    lastSyncedMetadata: metadata,
  }, previous, { queueOutbox: false })
  await db.outbox.delete(`day:${date}`)
}

// Applies a day's content as fetched from the remote repository. Unlike
// saveDay, this never queues an outbox entry -- there is nothing to push,
// since the content came from the remote in the first place.
export async function applyRemoteDay(date: string, markdown: string, sha: string): Promise<void> {
  const document = parseDayDocument(markdown)
  const previous = await db.days.get(date)
  if (previous?.markdown === document.markdown && JSON.stringify(previous.metadata) === JSON.stringify(document.metadata)) {
    await db.days.update(date, {
      remoteSha: sha,
      lastSyncedAt: new Date().toISOString(),
      lastSyncedMarkdown: document.markdown,
      lastSyncedMetadata: document.metadata,
    })
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
    lastSyncedMarkdown: document.markdown,
    lastSyncedMetadata: document.metadata,
  }, previous, { queueOutbox: false })
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('thread:day-external-update', { detail: { day: date, markdown: document.markdown } }))
}

// Thread-note counterpart to applyRemoteDay: adopts a note exactly as fetched
// from the remote repository. Never queues an outbox entry -- the content came
// from the remote, so there is nothing to push back. `remoteMarkdown` is the
// full serialized string (envelope included) and is stored verbatim so the
// remoteSha it pairs with, and the merge base for any later divergence, stay
// byte-exact.
export async function applyRemoteThreadNote(threadId: string, remoteMarkdown: string, sha: string): Promise<void> {
  const document = parseThreadDocument(remoteMarkdown)
  const now = new Date().toISOString()
  await db.transaction('rw', db.threadNotes, db.threadProperties, async () => {
    const previous = await db.threadNotes.get(threadId)
    if (previous?.markdown === remoteMarkdown) {
      await db.threadNotes.update(threadId, {
        remoteSha: sha,
        lastSyncedAt: now,
        lastSyncedMarkdown: remoteMarkdown,
        lastSyncedMetadata: document.metadata,
      })
      return
    }
    await db.threadNotes.put({
      threadId,
      markdown: remoteMarkdown,
      metadata: document.metadata,
      blockCount: countMarkdownBlocks(document.markdown),
      updatedAt: now,
      localRevision: (previous?.localRevision ?? 0) + 1,
      remoteSha: sha,
      lastSyncedAt: now,
      lastSyncedMarkdown: remoteMarkdown,
      lastSyncedMetadata: document.metadata,
    })
    await reindexThreadNote(threadId, document.metadata)
  })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('thread:day-external-update', { detail: { day: `thread:${threadId}`, markdown: document.markdown } }))
  }
}

export async function markConflictResolved(conflictId: string): Promise<void> {
  await db.conflicts.update(conflictId, { resolvedAt: new Date().toISOString() })
}
