import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createThread, db, renameThread, saveThreadNote } from '../../db'
import { commandRegistry, type CommandRegistry } from '../commands'
import { compileThreadScript } from './compiler'
import { dispatchApprovedProposal } from './dispatch'
import { resolvePlan } from './plan'
import { createProposal, getProposal } from './proposals'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

afterAll(() => db.close())

async function propose(source: string) {
  const compiled = compileThreadScript(source)
  const resolved = await resolvePlan(compiled)
  return createProposal({ sessionId: 'session-1', personaId: 'general', compiled, resolved })
}

describe('dispatchApprovedProposal', () => {
  it('executes a confirmed plan once and records a receipt per step', async () => {
    const id = await propose('action thread.create\n  title: "Atlas"\n')

    const result = await dispatchApprovedProposal(id)

    expect(result.status).toBe('completed')
    expect(result.receipts).toHaveLength(1)
    expect(result.receipts[0]).toMatchObject({ actionIndex: 0, capability: 'thread.create', status: 'completed' })
    expect(await db.threads.get('atlas')).toMatchObject({ title: 'Atlas' })
    expect((await getProposal(id))!.status).toBe('completed')
  })

  it('does not execute twice on a repeated confirm', async () => {
    const id = await propose('action thread.create\n  title: "Atlas"\n')

    await dispatchApprovedProposal(id)
    const second = await dispatchApprovedProposal(id)

    expect(second.status).toBe('completed')
    expect(await db.threads.count()).toBe(1)
  })

  it('does not execute twice when confirmed concurrently', async () => {
    const id = await propose('action thread.create\n  title: "Atlas"\n')

    const [a, b] = await Promise.all([dispatchApprovedProposal(id), dispatchApprovedProposal(id)])

    expect([a.status, b.status].filter((status) => status === 'completed').length).toBeGreaterThanOrEqual(1)
    expect(await db.threads.count()).toBe(1)
  })

  it('marks the proposal stale when a target was modified since it was proposed', async () => {
    const threadId = await createThread('Atlas')
    await saveThreadNote(threadId, '- Existing')
    const id = await propose('action thread.content.append\n  thread: "Atlas"\n  content: "- More"\n')

    await renameThread(threadId, 'Atlas Prime')

    const result = await dispatchApprovedProposal(id)
    expect(result.status).toBe('stale')
    expect((await getProposal(id))!.status).toBe('stale')
    expect((await db.threadNotes.get(threadId))!.markdown).toContain('- Existing')
    expect((await db.threadNotes.get(threadId))!.markdown).not.toContain('- More')
  })

  it('marks the proposal stale when the stored source hash no longer matches', async () => {
    const id = await propose('action thread.create\n  title: "Atlas"\n')
    await db.chatProposals.update(id, { sourceHash: 'deadbeef' })

    const result = await dispatchApprovedProposal(id)
    expect(result.status).toBe('stale')
    expect(await db.threads.count()).toBe(0)
  })

  it('marks the proposal stale when a would-be-created target now exists', async () => {
    const id = await propose('action thread.create\n  title: "Atlas"\n')
    await createThread('Atlas')

    const result = await dispatchApprovedProposal(id)
    expect(result.status).toBe('stale')
  })

  it('performs no write when the proposal was cancelled', async () => {
    const id = await propose('action thread.create\n  title: "Atlas"\n')
    await db.chatProposals.update(id, { status: 'cancelled' })

    const result = await dispatchApprovedProposal(id)
    expect(result.status).toBe('stale')
    expect(result.staleReason).toMatch(/cancelled/i)
    expect(await db.threads.count()).toBe(0)
  })

  it('stops at the first failing step and keeps earlier writes', async () => {
    const id = await propose('action thread.create\n  title: "Atlas"\n\naction thread.rename\n  thread: "Atlas"\n  title: "Atlas Two"\n')

    const failing = {
      prepare: commandRegistry.prepare.bind(commandRegistry),
      execute: async (prepared: Parameters<CommandRegistry['execute']>[0], ctx: Parameters<CommandRegistry['execute']>[1]) => {
        if (prepared.capability === 'thread.rename') throw new Error('boom')
        return commandRegistry.execute(prepared, ctx)
      },
    } as unknown as CommandRegistry

    const result = await dispatchApprovedProposal(id, { registry: failing })

    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/Step 2 \(thread\.rename\) failed: boom/)
    expect(await db.threads.get('atlas')).toBeTruthy()
    expect(result.receipts.map((receipt) => receipt.status)).toEqual(['completed', 'failed'])
  })

  it('skips steps that already have a completed receipt on reload recovery', async () => {
    const id = await propose('action thread.create\n  title: "Atlas"\n\naction thread.rename\n  thread: "Atlas"\n  title: "Atlas Two"\n')
    await createThread('Atlas')
    const seededAt = '2020-01-01T00:00:00.000Z'
    await db.chatProposals.update(id, {
      receipts: [{ actionIndex: 0, capability: 'thread.create', status: 'completed', idempotencyKey: `${id}:0`, output: { thread: 'atlas', created: true }, at: seededAt }],
    })

    const result = await dispatchApprovedProposal(id)

    expect(result.status).toBe('completed')
    expect(result.receipts[0].at).toBe(seededAt)
    expect(result.receipts).toHaveLength(2)
    expect(await db.threads.get('atlas')).toMatchObject({ title: 'Atlas Two' })
  })
})
