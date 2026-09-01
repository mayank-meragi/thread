import { db, type ChatProposalReceipt, type ChatProposalRecord } from '../../db'
import { commandRegistry, type CommandRegistry } from '../commands'
import { compileThreadScript } from './compiler'
import { resolvePlan, stableStringify, type ResolvedPlan } from './plan'
import { getProposal, markProposalStale } from './proposals'
import type { PlanPreview, PlanTargetCapture } from './types'

export interface DispatchResult {
  status: 'completed' | 'failed' | 'stale'
  receipts: ChatProposalReceipt[]
  error?: string
  staleReason?: string
}

function nowIso(): string {
  return new Date().toISOString()
}

// Semantic fingerprint of the not-yet-executed work: the change kind, field,
// before/after values, and *identity* of each target -- but not the target's
// `version`, which is volatile and covered separately by `expectedVersions`.
function changeSignature(preview: PlanPreview, skip: Set<number>): string {
  return stableStringify(
    preview.steps
      .filter((step) => !skip.has(step.actionIndex))
      .map((step) => step.preview.changes.map((change) => ({
        kind: change.kind,
        field: change.field,
        before: change.before,
        after: change.after,
        target: { kind: change.target.kind, id: change.target.id, label: change.target.label },
      }))),
  )
}

function targetsByAction(captures: PlanTargetCapture[], skip: Set<number>): Map<number, Set<string>> {
  const map = new Map<number, Set<string>>()
  for (const capture of captures) {
    if (skip.has(capture.actionIndex)) continue
    if (!map.has(capture.actionIndex)) map.set(capture.actionIndex, new Set())
    map.get(capture.actionIndex)!.add(capture.ref)
  }
  return map
}

// Compares a freshly re-resolved plan against the one the user approved,
// ignoring steps that already completed (reload recovery re-runs the plan and
// those steps' effects are legitimately already applied). Returns a
// human-readable reason when the meaning of the *remaining* work has drifted,
// or `undefined` when it is safe to execute.
function detectStale(proposal: ChatProposalRecord, fresh: ResolvedPlan, skip: Set<number>): string | undefined {
  const approved = proposal.preview.steps
  const current = fresh.preview.steps
  if (approved.length !== current.length) return 'The plan no longer has the same number of steps.'
  for (let index = 0; index < approved.length; index += 1) {
    if (skip.has(index)) continue
    if (approved[index].capability !== current[index].capability) return `Step ${index + 1} is now a different action.`
    if (current[index].status === 'deferred') return `Step ${index + 1} can no longer be fully resolved.`
  }

  const approvedTargets = targetsByAction(proposal.capturedTargets, skip)
  const currentTargets = targetsByAction(fresh.capturedTargets, skip)
  for (const [actionIndex, refs] of approvedTargets) {
    const other = currentTargets.get(actionIndex) ?? new Set<string>()
    if (refs.size !== other.size || [...refs].some((ref) => !other.has(ref))) return `The objects affected by step ${actionIndex + 1} changed.`
  }
  for (const actionIndex of currentTargets.keys()) {
    if (!approvedTargets.has(actionIndex)) return `The objects affected by step ${actionIndex + 1} changed.`
  }

  // Refs a now-completed step was going to create: those are *expected* to
  // have flipped from "does not exist" to "exists" on a recovery re-run.
  const createdByDone = new Set(
    proposal.capturedTargets.filter((capture) => skip.has(capture.actionIndex) && !capture.exists).map((capture) => capture.ref),
  )
  const remainingRefs = new Set(fresh.capturedTargets.filter((capture) => !skip.has(capture.actionIndex)).map((capture) => capture.ref))
  const currentExists = new Map(fresh.capturedTargets.map((capture) => [capture.ref, capture.exists]))
  for (const capture of proposal.capturedTargets) {
    if (skip.has(capture.actionIndex)) continue
    if (createdByDone.has(capture.ref) && !capture.exists && currentExists.get(capture.ref)) continue
    if (currentExists.has(capture.ref) && currentExists.get(capture.ref) !== capture.exists) {
      return capture.exists ? `“${capture.ref}” no longer exists.` : `“${capture.ref}” already exists.`
    }
  }

  for (const [ref, version] of Object.entries(proposal.expectedVersions)) {
    if (!remainingRefs.has(ref) || createdByDone.has(ref)) continue
    if (!(ref in fresh.expectedVersions) || fresh.expectedVersions[ref] !== version) {
      return `“${ref}” was modified since this was proposed.`
    }
  }

  if (changeSignature(proposal.preview, skip) !== changeSignature(fresh.preview, skip)) {
    return 'The previewed effects are no longer accurate.'
  }
  return undefined
}

// The trusted execution path. Invoked ONLY by the Confirm control in the
// approval card -- never wrapped in an AI tool, never imported by aiChat.ts.
// Re-compiles and re-resolves the stored source every time, so model-authored
// text is always re-checked against the registry before anything runs.
export async function dispatchApprovedProposal(
  proposalId: string,
  ctx: { registry?: CommandRegistry } = {},
): Promise<DispatchResult> {
  const registry = ctx.registry ?? commandRegistry
  const proposal = await getProposal(proposalId)
  if (!proposal) throw new Error('This proposal no longer exists.')

  switch (proposal.status) {
    case 'completed':
      return { status: 'completed', receipts: proposal.receipts }
    case 'failed':
      return { status: 'failed', receipts: proposal.receipts, error: proposal.error }
    case 'cancelled':
      return { status: 'stale', receipts: proposal.receipts, staleReason: 'This proposal was cancelled.' }
    case 'stale':
      return { status: 'stale', receipts: proposal.receipts, staleReason: proposal.error ?? 'This proposal is stale.' }
    case 'executing':
      return { status: 'failed', receipts: proposal.receipts, error: 'This proposal is already executing.' }
    default:
      break
  }

  if (proposal.risk === 'external') throw new Error('External ThreadScript actions are not supported in this version.')

  let compiled
  try {
    compiled = compileThreadScript(proposal.source)
  } catch {
    const reason = 'The script no longer compiles.'
    await markProposalStale(proposalId, reason)
    return { status: 'stale', receipts: proposal.receipts, staleReason: reason }
  }
  if (compiled.sourceHash !== proposal.sourceHash) {
    const reason = 'The script changed since it was proposed.'
    await markProposalStale(proposalId, reason)
    return { status: 'stale', receipts: proposal.receipts, staleReason: reason }
  }

  let fresh: ResolvedPlan
  try {
    fresh = await resolvePlan(compiled, { registry, resolution: { activePersonaId: proposal.personaId } })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    await markProposalStale(proposalId, reason)
    return { status: 'stale', receipts: proposal.receipts, staleReason: reason }
  }

  const alreadyDone = new Set(proposal.receipts.filter((receipt) => receipt.status === 'completed').map((receipt) => receipt.actionIndex))
  const staleReason = detectStale(proposal, fresh, alreadyDone)
  if (staleReason) {
    await markProposalStale(proposalId, staleReason)
    return { status: 'stale', receipts: proposal.receipts, staleReason }
  }

  // Claim atomically so a second Confirm (double-click) cannot start a second run.
  const claimed = await db.transaction('rw', db.chatProposals, async () => {
    const current = await db.chatProposals.get(proposalId)
    if (!current || current.status !== 'pending') return false
    await db.chatProposals.update(proposalId, { status: 'executing', updatedAt: nowIso() })
    return true
  })
  if (!claimed) return dispatchApprovedProposal(proposalId, ctx)

  const receipts: ChatProposalReceipt[] = [...proposal.receipts]
  const completed = new Set(receipts.filter((receipt) => receipt.status === 'completed').map((receipt) => receipt.actionIndex))

  for (const step of fresh.preview.steps) {
    if (completed.has(step.actionIndex)) continue
    const idempotencyKey = `${proposalId}:${step.actionIndex}`
    const preparedStep = fresh.prepared[step.actionIndex]

    if (!preparedStep) {
      const summary = `Step ${step.actionIndex + 1} (${step.capability}) could not be resolved for execution.`
      receipts.push({ actionIndex: step.actionIndex, capability: step.capability, status: 'failed', idempotencyKey, error: summary, at: nowIso() })
      await db.chatProposals.update(proposalId, { status: 'failed', receipts, error: summary, resolvedAt: nowIso(), updatedAt: nowIso() })
      return { status: 'failed', receipts, error: summary }
    }

    try {
      const output = await registry.execute(preparedStep, { idempotencyKey })
      receipts.push({ actionIndex: step.actionIndex, capability: step.capability, status: 'completed', idempotencyKey, output, at: nowIso() })
      await db.chatProposals.update(proposalId, { receipts, updatedAt: nowIso() })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const summary = `Step ${step.actionIndex + 1} (${step.capability}) failed: ${message}`
      receipts.push({ actionIndex: step.actionIndex, capability: step.capability, status: 'failed', idempotencyKey, error: message, at: nowIso() })
      await db.chatProposals.update(proposalId, { status: 'failed', receipts, error: summary, resolvedAt: nowIso(), updatedAt: nowIso() })
      return { status: 'failed', receipts, error: summary }
    }
  }

  await db.chatProposals.update(proposalId, { status: 'completed', receipts, resolvedAt: nowIso(), updatedAt: nowIso() })
  return { status: 'completed', receipts }
}
