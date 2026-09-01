import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db'
import { createSession, deleteSession } from '../personas'
import { compileThreadScript } from './compiler'
import { resolvePlan } from './plan'
import { cancelProposal, createProposal, getProposal } from './proposals'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

afterAll(() => db.close())

async function makeProposal(sessionId: string) {
  const compiled = compileThreadScript('action thread.create as t\n  title: "Atlas"\n')
  const resolved = await resolvePlan(compiled)
  const id = await createProposal({ sessionId, personaId: 'general', compiled, resolved })
  return { id, compiled }
}

describe('chat proposals', () => {
  it('persists a pending snapshot of the compiled + resolved plan', async () => {
    const sessionId = await createSession('general')
    const { id, compiled } = await makeProposal(sessionId)

    const proposal = await getProposal(id)
    expect(proposal).toMatchObject({
      sessionId,
      personaId: 'general',
      status: 'pending',
      sourceHash: compiled.sourceHash,
      receipts: [],
    })
    expect(proposal!.preview.steps).toHaveLength(1)
    expect(proposal!.plan.actions[0].capability).toBe('thread.create')
  })

  it('only cancels a still-pending proposal', async () => {
    const sessionId = await createSession('general')
    const { id } = await makeProposal(sessionId)

    await cancelProposal(id)
    expect((await getProposal(id))!.status).toBe('cancelled')

    await db.chatProposals.update(id, { status: 'executing' })
    await cancelProposal(id)
    expect((await getProposal(id))!.status).toBe('executing')
  })

  it('is removed when its session is deleted', async () => {
    const sessionId = await createSession('general')
    const { id } = await makeProposal(sessionId)

    await deleteSession(sessionId)
    expect(await getProposal(id)).toBeUndefined()
  })
})
