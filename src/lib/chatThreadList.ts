import { createAssistantStream } from 'assistant-stream'
import type { RemoteThreadListAdapter, ThreadMessage } from '@assistant-ui/react'
import { db, type ChatSessionRecord } from '../db'
import { deleteSession, renameSession } from './personas'

// `RemoteThreadMetadata` isn't re-exported from `@assistant-ui/react`; derive it
// from the adapter's own `list()` signature.
type RemoteThreadMetadata = Awaited<ReturnType<RemoteThreadListAdapter['list']>>['threads'][number]

// Backs assistant-ui's thread list with the per-persona `chatSessions` table.
// One adapter per persona (memoised in ChatPanel); the runtime calls `list()`
// on mount, `initialize()` the first time a new thread is sent to, and
// rename/archive/delete on the corresponding `ThreadListItemPrimitive` actions.
// `list()` is pull-based -- an `updatedAt` bump from elsewhere (the history
// adapter, the ThreadScript dispatcher) is not reflected until the next mount.

function toMetadata(row: ChatSessionRecord): RemoteThreadMetadata {
  return {
    status: row.status === 'archived' ? 'archived' : 'regular',
    remoteId: row.id,
    title: row.title,
    lastMessageAt: new Date(row.updatedAt),
  }
}

// Local stand-in for a title model: the first line of the first user message,
// clipped. Runs once per session (right after `initialize`).
function deriveTitle(messages: readonly ThreadMessage[]): string {
  const firstUser = messages.find((message) => message.role === 'user')
  const text = (firstUser?.content ?? [])
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return 'Untitled'
  return text.length > 48 ? `${text.slice(0, 47).trimEnd()}…` : text
}

export function createChatThreadListAdapter(personaId: string): RemoteThreadListAdapter {
  return {
    async list() {
      const rows = await db.chatSessions.where('personaId').equals(personaId).reverse().sortBy('updatedAt')
      return { threads: rows.map(toMetadata) }
    },

    async initialize(threadId) {
      const existing = await db.chatSessions.get(threadId)
      if (!existing) {
        const now = new Date().toISOString()
        await db.chatSessions.put({ id: threadId, personaId, title: 'Untitled', createdAt: now, updatedAt: now })
      }
      return { remoteId: threadId }
    },

    async rename(remoteId, newTitle) {
      await renameSession(remoteId, newTitle)
    },

    async archive(remoteId) {
      await db.chatSessions.update(remoteId, { status: 'archived', updatedAt: new Date().toISOString() })
    },

    async unarchive(remoteId) {
      await db.chatSessions.update(remoteId, { status: 'regular', updatedAt: new Date().toISOString() })
    },

    async delete(remoteId) {
      await deleteSession(remoteId)
    },

    async generateTitle(remoteId, messages) {
      const title = deriveTitle(messages)
      await db.chatSessions.update(remoteId, { title })
      // The runtime reads the new title off this stream to update the in-memory
      // list item; the DB write above is what makes it survive a reload.
      return createAssistantStream((controller) => {
        controller.appendText(title)
      })
    },

    async fetch(threadId) {
      const row = await db.chatSessions.get(threadId)
      if (!row) throw new Error(`Chat session "${threadId}" not found.`)
      return toMetadata(row)
    },
  }
}
