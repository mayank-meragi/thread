import { db, type ChatProposalRecord } from '../../db'
import type { ResolvedPlan } from './plan'
import type { CompiledThreadScript } from './types'

function nowIso(): string {
  return new Date().toISOString()
}

// Persists a compiled + resolved ThreadScript as a `pending` proposal. No
// domain write happens here -- the proposal is inert until the user confirms
// it (see `dispatchApprovedProposal`).
export async function createProposal(input: {
  sessionId: string
  personaId: string
  messageId?: string
  compiled: CompiledThreadScript
  resolved: ResolvedPlan
}): Promise<string> {
  const id = crypto.randomUUID()
  const now = nowIso()
  const record: ChatProposalRecord = {
    id,
    sessionId: input.sessionId,
    personaId: input.personaId,
    messageId: input.messageId,
    source: input.compiled.source,
    sourceHash: input.compiled.sourceHash,
    description: input.compiled.description,
    risk: input.resolved.preview.risk,
    status: 'pending',
    plan: input.compiled,
    preview: input.resolved.preview,
    capturedTargets: input.resolved.capturedTargets,
    expectedVersions: input.resolved.expectedVersions,
    receipts: [],
    createdAt: now,
    updatedAt: now,
  }
  await db.chatProposals.put(record)
  return id
}

export async function getProposal(id: string): Promise<ChatProposalRecord | undefined> {
  return db.chatProposals.get(id)
}

// Cancel is a no-op unless the proposal is still `pending` -- an executing or
// already-terminal proposal cannot be cancelled from under the dispatcher.
export async function cancelProposal(id: string): Promise<void> {
  await db.transaction('rw', db.chatProposals, async () => {
    const current = await db.chatProposals.get(id)
    if (!current || current.status !== 'pending') return
    const now = nowIso()
    await db.chatProposals.update(id, { status: 'cancelled', resolvedAt: now, updatedAt: now })
  })
}

export async function markProposalStale(id: string, reason: string): Promise<void> {
  const now = nowIso()
  await db.chatProposals.update(id, { status: 'stale', error: reason, resolvedAt: now, updatedAt: now })
}
