import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { createChatThreadListAdapter } from './chatThreadList'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})
afterAll(() => db.close())

const userMsg = (text: string) => ({ role: 'user' as const, content: [{ type: 'text' as const, text }] }) as never

describe('createChatThreadListAdapter', () => {
  it('lists a persona’s sessions newest-first with status metadata', async () => {
    await db.chatSessions.bulkPut([
      { id: 's1', personaId: 'p', title: 'One', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
      { id: 's2', personaId: 'p', title: 'Two', createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z' },
      { id: 's3', personaId: 'other', title: 'Nope', createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z' },
      { id: 's4', personaId: 'p', title: 'Archived', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z', status: 'archived' },
    ])

    const { threads } = await createChatThreadListAdapter('p').list()
    expect(threads.map((t) => [t.remoteId, t.status])).toEqual([
      ['s2', 'regular'],
      ['s4', 'archived'],
      ['s1', 'regular'],
    ])
    expect(threads[0]).toMatchObject({ title: 'Two', lastMessageAt: new Date('2026-09-03T00:00:00.000Z') })
  })

  it('initialize creates the session row under the given id, idempotently', async () => {
    const adapter = createChatThreadListAdapter('p')
    expect(await adapter.initialize('new-1')).toEqual({ remoteId: 'new-1' })
    const row = await db.chatSessions.get('new-1')
    expect(row).toMatchObject({ id: 'new-1', personaId: 'p', title: 'Untitled' })

    await db.chatSessions.update('new-1', { title: 'Renamed' })
    await adapter.initialize('new-1')
    expect((await db.chatSessions.get('new-1'))?.title).toBe('Renamed')
  })

  it('rename / archive / unarchive update the row', async () => {
    await db.chatSessions.put({ id: 's1', personaId: 'p', title: 'x', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' })
    const adapter = createChatThreadListAdapter('p')

    await adapter.rename('s1', '  New name  ')
    expect((await db.chatSessions.get('s1'))?.title).toBe('New name')

    await adapter.archive('s1')
    expect((await db.chatSessions.get('s1'))?.status).toBe('archived')
    await adapter.unarchive('s1')
    expect((await db.chatSessions.get('s1'))?.status).toBe('regular')
  })

  it('delete cascades to the session’s messages and proposals', async () => {
    await db.chatSessions.put({ id: 's1', personaId: 'p', title: 'x', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' })
    await db.chatMessages.put({ id: 'm1', sessionId: 's1', role: 'user', content: 'hi', parentId: null, createdAt: '2026-09-01T00:00:01.000Z' })
    await db.chatProposals.put({ id: 'pr1', sessionId: 's1', status: 'pending', receipts: [] } as never)

    await createChatThreadListAdapter('p').delete('s1')
    expect(await db.chatSessions.get('s1')).toBeUndefined()
    expect(await db.chatMessages.where('sessionId').equals('s1').count()).toBe(0)
    expect(await db.chatProposals.where('sessionId').equals('s1').count()).toBe(0)
  })

  it('generateTitle derives a clipped title from the first user message and persists it', async () => {
    await db.chatSessions.put({ id: 's1', personaId: 'p', title: 'Untitled', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' })
    const long = 'Please help me plan a very long and detailed strength training programme for the next quarter'

    await createChatThreadListAdapter('p').generateTitle('s1', [userMsg(long)])
    const title = (await db.chatSessions.get('s1'))?.title ?? ''
    expect(title.length).toBeLessThanOrEqual(48)
    expect(title.startsWith('Please help me plan a very long')).toBe(true)
    expect(title.endsWith('…')).toBe(true)
  })

  it('generateTitle falls back to Untitled with no user text', async () => {
    await db.chatSessions.put({ id: 's1', personaId: 'p', title: 'x', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' })
    await createChatThreadListAdapter('p').generateTitle('s1', [])
    expect((await db.chatSessions.get('s1'))?.title).toBe('Untitled')
  })

  it('fetch returns metadata or throws for a missing session', async () => {
    await db.chatSessions.put({ id: 's1', personaId: 'p', title: 'x', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' })
    const adapter = createChatThreadListAdapter('p')
    expect(await adapter.fetch('s1')).toMatchObject({ remoteId: 's1', status: 'regular', title: 'x' })
    await expect(adapter.fetch('nope')).rejects.toThrow(/not found/)
  })
})
