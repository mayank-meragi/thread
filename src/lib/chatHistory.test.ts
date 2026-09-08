import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createChatHistoryAdapter } from './chatHistory'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
  await db.chatSessions.put({ id: 's1', personaId: 'general', title: 'Chat', createdAt: '2026-09-02T10:00:00.000Z', updatedAt: '2026-09-02T10:00:00.000Z' })
})
afterAll(() => db.close())

// Minimal ThreadMessage-shaped fixture; the adapter only reads id/role/content/
// createdAt/status.
function msg(over: Partial<Record<string, unknown>> & { id: string; role: 'user' | 'assistant'; content: unknown }) {
  return { createdAt: new Date('2026-09-02T10:00:01.000Z'), ...over } as never
}
const item = (message: unknown, parentId: string | null) => ({ message, parentId }) as never

describe('createChatHistoryAdapter — append/update', () => {
  it('stores a lone text reply as a bare string with its parentId', async () => {
    const history = createChatHistoryAdapter('s1')
    await history.append(item(msg({ id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'hello' }] }), 'u1'))

    const row = await db.chatMessages.get('a1')
    expect(row).toMatchObject({ id: 'a1', sessionId: 's1', role: 'assistant', content: 'hello', parentId: 'u1' })
  })

  it('keeps a reasoning + text reply as an ordered parts array', async () => {
    const history = createChatHistoryAdapter('s1')
    await history.append(item(msg({
      id: 'a1', role: 'assistant',
      content: [{ type: 'reasoning', text: 'hmm' }, { type: 'text', text: 'done' }],
    }), 'u1'))

    expect((await db.chatMessages.get('a1'))?.content).toEqual([
      { type: 'reasoning', text: 'hmm' },
      { type: 'text', text: 'done' },
    ])
  })

  it('upserts on the message id and preserves the original createdAt', async () => {
    const history = createChatHistoryAdapter('s1')
    await history.append(item(msg({ id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'v1' }], createdAt: new Date('2026-09-02T10:00:01.000Z') }), 'u1'))
    await history.append(item(msg({ id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'v2' }], createdAt: new Date('2026-09-02T10:05:00.000Z') }), 'u1'))

    expect(await db.chatMessages.where('sessionId').equals('s1').count()).toBe(1)
    const row = await db.chatMessages.get('a1')
    expect(row?.content).toBe('v2')
    expect(row?.createdAt).toBe('2026-09-02T10:00:01.000Z')
  })

  it('persists the paused status, then drops it when update() resolves the gate', async () => {
    const history = createChatHistoryAdapter('s1')
    const gated = {
      id: 'a1', role: 'assistant' as const,
      content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'proposeThreadScript', args: {}, argsText: '{}', approval: { id: 'p1' } }],
      status: { type: 'requires-action', reason: 'tool-calls' },
    }
    await history.append(item(msg(gated), 'u1'))
    expect((await db.chatMessages.get('a1'))?.status).toEqual({ type: 'requires-action', reason: 'tool-calls' })

    await history.update!(item(msg({ ...gated, status: { type: 'complete' } }), 'u1'))
    expect((await db.chatMessages.get('a1'))?.status).toBeUndefined()
  })

  it('skips a blank assistant row but keeps a blank user row', async () => {
    const history = createChatHistoryAdapter('s1')
    await history.append(item(msg({ id: 'a1', role: 'assistant', content: [] }), 'u1'))
    await history.append(item(msg({ id: 'u1', role: 'user', content: [] }), null))

    expect(await db.chatMessages.get('a1')).toBeUndefined()
    expect(await db.chatMessages.get('u1')).toBeDefined()
  })

  it('bumps the session updatedAt', async () => {
    const history = createChatHistoryAdapter('s1')
    await history.append(item(msg({ id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] }), 'u1'))
    expect((await db.chatSessions.get('s1'))?.updatedAt).not.toBe('2026-09-02T10:00:00.000Z')
  })
})

describe('createChatHistoryAdapter — load', () => {
  it('returns messages in createdAt order with a linear parent chain', async () => {
    await db.chatMessages.bulkPut([
      { id: 'u1', sessionId: 's1', role: 'user', content: 'hi', parentId: null, createdAt: '2026-09-02T10:00:00.000Z' },
      { id: 'a1', sessionId: 's1', role: 'assistant', content: 'hello', parentId: 'u1', createdAt: '2026-09-02T10:00:01.000Z' },
    ])

    const repo = await createChatHistoryAdapter('s1').load()
    expect(repo.messages.map((m) => [m.message.id, m.parentId])).toEqual([
      ['u1', null],
      ['a1', 'u1'],
    ])
  })

  it('round-trips a tool-call part and a paused approval status', async () => {
    await db.chatMessages.bulkPut([
      { id: 'u1', sessionId: 's1', role: 'user', content: 'make a thread', parentId: null, createdAt: '2026-09-02T10:00:00.000Z' },
      {
        id: 'a1', sessionId: 's1', role: 'assistant', parentId: 'u1', createdAt: '2026-09-02T10:00:01.000Z',
        status: { type: 'requires-action', reason: 'tool-calls' },
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'proposeThreadScript', args: {}, argsText: '{}', approval: { id: 'p9' } }],
      },
    ])

    const repo = await createChatHistoryAdapter('s1').load()
    const assistant = repo.messages[1].message
    expect(assistant.status).toMatchObject({ type: 'requires-action' })
    expect(assistant.content[0]).toMatchObject({ type: 'tool-call', toolName: 'proposeThreadScript', approval: { id: 'p9' } })
  })

  it('returns an empty repository for a session with no messages', async () => {
    expect(await createChatHistoryAdapter('s1').load()).toEqual({ messages: [] })
  })

  it('exposes two assistant children of one user message as branches', async () => {
    await db.chatMessages.bulkPut([
      { id: 'u1', sessionId: 's1', role: 'user', content: 'hi', parentId: null, createdAt: '2026-09-02T10:00:00.000Z' },
      { id: 'a1', sessionId: 's1', role: 'assistant', content: 'first', parentId: 'u1', createdAt: '2026-09-02T10:00:01.000Z' },
      { id: 'a2', sessionId: 's1', role: 'assistant', content: 'second', parentId: 'u1', createdAt: '2026-09-02T10:00:02.000Z' },
    ])

    const repo = await createChatHistoryAdapter('s1').load()
    expect(repo.messages.filter((m) => m.parentId === 'u1').map((m) => m.message.id)).toEqual(['a1', 'a2'])
  })
})

describe('createChatHistoryAdapter — delete', () => {
  it('removes the given messages by id', async () => {
    await db.chatMessages.bulkPut([
      { id: 'u1', sessionId: 's1', role: 'user', content: 'hi', parentId: null, createdAt: '2026-09-02T10:00:00.000Z' },
      { id: 'a1', sessionId: 's1', role: 'assistant', content: 'hello', parentId: 'u1', createdAt: '2026-09-02T10:00:01.000Z' },
    ])

    await createChatHistoryAdapter('s1').delete!([item({ id: 'a1' }, 'u1')])
    expect(await db.chatMessages.get('a1')).toBeUndefined()
    expect(await db.chatMessages.get('u1')).toBeDefined()
  })
})
