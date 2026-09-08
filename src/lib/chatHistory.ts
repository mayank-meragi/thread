import {
  ExportedMessageRepository,
  type ExportedMessageRepositoryItem,
  type ThreadHistoryAdapter,
  type ThreadMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import { db, type ChatMessagePartRecord, type ChatMessageRecord } from '../db'

// assistant-ui drives chat persistence through this adapter (wired as
// `useLocalRuntime(adapter, { adapters: { history } })`). The runtime calls
// `load()` once on mount, `append()` when a message first lands, and `update()`
// to finalize a message that was persisted while paused on a tool-approval gate
// (keyed on the message id -- treat both as upserts). The chat-model adapter in
// `aiChat.ts` no longer touches the database itself.

type StoredContent = string | ChatMessagePartRecord[]

// Collapse an assistant/user message's parts to the row shape. A lone text part
// stays a bare string (matches the pre-adapter storage and keeps user rows
// simple); anything richer -- reasoning, tool calls -- is kept as an ordered
// array so the inline UI (ThreadScript proposal card, thinking disclosure)
// survives a reload.
function serializeContent(message: ThreadMessage): StoredContent {
  const parts: ChatMessagePartRecord[] = []
  for (const part of message.content) {
    if (part.type === 'text') {
      parts.push({ type: 'text', text: part.text })
    } else if (part.type === 'reasoning') {
      parts.push({ type: 'reasoning', text: part.text })
    } else if (part.type === 'tool-call') {
      parts.push({
        type: 'tool-call',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        args: part.args,
        argsText: part.argsText,
        ...(part.result !== undefined ? { result: part.result } : {}),
        ...(part.isError !== undefined ? { isError: part.isError } : {}),
        ...(part.approval ? { approval: part.approval } : {}),
      })
    }
    // source / file / image parts aren't produced by this app -- skip them.
  }
  if (parts.length === 0) return ''
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text
  return parts
}

function isEmptyContent(content: StoredContent): boolean {
  return content === '' || (Array.isArray(content) && content.length === 0)
}

function toIso(date: Date | undefined): string {
  return date instanceof Date ? date.toISOString() : new Date().toISOString()
}

export function createChatHistoryAdapter(sessionId: string): ThreadHistoryAdapter {
  // One idempotent upsert keyed on the runtime message id, shared by append and
  // update. `status` is only carried while a turn is paused on an approval gate;
  // a plain `put` replaces the row, so omitting it on the resolving `update()`
  // is what drops the `requires-action` state.
  async function put(item: ExportedMessageRepositoryItem): Promise<void> {
    const { message } = item
    if (message.role !== 'user' && message.role !== 'assistant') return
    const content = serializeContent(message)
    // A run that produced nothing (Stop before the first token) still terminates
    // as `complete` -- don't leave a blank assistant row behind.
    if (message.role === 'assistant' && isEmptyContent(content)) return

    const existing = await db.chatMessages.get(message.id)
    const row: ChatMessageRecord = {
      id: message.id,
      sessionId,
      role: message.role,
      content,
      parentId: item.parentId ?? null,
      createdAt: existing?.createdAt ?? toIso(message.createdAt),
    }
    if (message.status?.type === 'requires-action') {
      row.status = { type: 'requires-action', reason: 'tool-calls' }
    }
    await db.chatMessages.put(row)
    await db.chatSessions.update(sessionId, { updatedAt: new Date().toISOString() })
  }

  return {
    async load() {
      const rows = await db.chatMessages.where('sessionId').equals(sessionId).sortBy('createdAt')
      if (rows.length === 0) return { messages: [] }
      const items = rows.map((row) => ({
        parentId: row.parentId ?? null,
        message: {
          id: row.id,
          role: row.role,
          content: row.content as ThreadMessageLike['content'],
          createdAt: new Date(row.createdAt),
          // Rehydrate a turn still paused on an approval gate so the runtime
          // re-enters `requires-action` and the card's Confirm/Cancel stay live.
          ...(row.status ? { status: row.status } : {}),
        } satisfies ThreadMessageLike,
      }))
      // No `unstable_resume`: a half-streamed model call can't be resumed
      // client-side, and the approval gate resumes through the chat-model
      // adapter (re-invoked by `respondToApproval`), not through `resume()`.
      return ExportedMessageRepository.fromBranchableArray(items)
    },

    append: put,
    update: put,

    async delete(items) {
      await db.chatMessages.bulkDelete(items.map((item) => item.message.id))
    },
  }
}
