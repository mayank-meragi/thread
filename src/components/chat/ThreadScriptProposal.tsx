import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, Loader2, X } from 'lucide-react'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { db } from '../../db'
import { DynamicIcon } from '../../lib/icons'
import { dispatchApprovedProposal } from '../../lib/threadscript/dispatch'
import { cancelProposal } from '../../lib/threadscript/proposals'
import { isPlanTrusted, trustCapabilities } from '../../lib/threadscript/trustedCapabilities'
import { ActionPreview } from './ActionPreview'
import { ActionResult } from './ActionResult'

type ProposeResult = {
  created?: boolean
  proposalId?: string
  diagnostics?: Array<{ message: string }>
}

const SUBTITLE: Record<string, string> = {
  pending: 'The assistant wants to change your workspace',
  executing: 'Applying changes…',
  completed: 'Changes applied',
  failed: 'Some steps failed',
  cancelled: 'You declined this',
  stale: 'The workspace changed — ask again',
}

// Renders the `proposeThreadScript` tool call as an approval card. The tool
// never executes a workspace change -- it drafts a pending `chatProposals` row
// and pauses the turn on an assistant-ui approval gate. Allow once / Always
// allow run the trusted dispatcher, then resolve the gate.
export function ThreadScriptProposal({ status, result, approval, respondToApproval }: ToolCallMessagePartProps<{ source?: string }, ProposeResult>) {
  const proposalId = approval?.id ?? result?.proposalId ?? null
  const proposal = useLiveQuery(() => (proposalId ? db.chatProposals.get(proposalId) : undefined), [proposalId])
  const [busy, setBusy] = useState(false)
  // Set the instant any of Allow once / Always allow / Deny / auto-approve runs,
  // so the resolve path (dispatch + respondToApproval) can never fire twice --
  // the second call throws "Tool call has no pending approval".
  const resolvedRef = useRef(false)

  const gateOpen = Boolean(respondToApproval) && approval?.approved === undefined
  const preview = proposal?.preview
  const proposalStatus = proposal?.status
  const canAuto = gateOpen && proposalStatus === 'pending' && !!preview && isPlanTrusted(preview)

  const answerGate = useCallback((approved: boolean) => {
    if (!gateOpen) return
    try {
      respondToApproval?.(approved ? { approved: true } : { approved: false, reason: 'Declined by user' })
    } catch {
      // Gate already closed (reload race / adapter finalize) -- nothing to do.
    }
  }, [gateOpen, respondToApproval])

  const runConfirm = useCallback(async () => {
    if (!proposalId || resolvedRef.current) return
    resolvedRef.current = true
    setBusy(true)
    try {
      await dispatchApprovedProposal(proposalId)
      answerGate(true)
    } finally {
      setBusy(false)
    }
  }, [proposalId, answerGate])

  useEffect(() => {
    if (canAuto && !resolvedRef.current) void runConfirm()
  }, [canAuto, runConfirm])

  // Draft still in flight, or it failed to compile/resolve (no proposal row).
  if (!proposalId) {
    const running = status.type === 'running'
    return (
      <div className="chat-tool">
        <div className="chat-tool-row chat-tool-row-static">
          <span className="chat-tool-status" data-state={running ? 'running' : 'error'} aria-hidden="true">
            {running ? <Loader2 size={13} className="chat-spin" /> : <X size={13} />}
          </span>
          <span className="chat-tool-label">
            {running ? 'Drafting a proposal…' : `Draft failed: ${result?.diagnostics?.[0]?.message ?? 'invalid script'}`}
          </span>
        </div>
      </div>
    )
  }

  if (!proposal || !preview || !proposalStatus) {
    return <div className="chat-approval chat-approval-loading">Loading proposal…</div>
  }

  const { risk, receipts } = proposal
  const orderedReceipts = [...receipts].sort((a, b) => a.actionIndex - b.actionIndex)
  const isPending = proposalStatus === 'pending'
  const isDone = proposalStatus === 'completed' || proposalStatus === 'failed'

  const cancel = async () => {
    if (resolvedRef.current) return
    resolvedRef.current = true
    setBusy(true)
    try {
      await cancelProposal(proposalId)
      answerGate(false)
    } finally {
      setBusy(false)
    }
  }
  const alwaysAllow = async () => {
    trustCapabilities(preview.steps.map((step) => step.capability))
    await runConfirm()
  }

  const subtitle = isPending && risk === 'destructive'
    ? `${SUBTITLE.pending} · includes destructive changes`
    : SUBTITLE[proposalStatus] ?? ''

  return (
    <div className={`chat-approval chat-approval-${proposalStatus}`}>
      <div className="chat-approval-head">
        <span className="chat-approval-icon"><DynamicIcon name="SquareTerminal" size={18} /></span>
        <div className="chat-approval-heading">
          <div className="chat-approval-title">{preview.description ?? 'Apply changes'}</div>
          {subtitle ? <div className="chat-approval-sub">{subtitle}</div> : null}
        </div>
        <span className="chat-approval-badge">{proposalStatus}</span>
      </div>

      {proposalStatus === 'stale' ? (
        <p className="chat-approval-note">
          <AlertTriangle size={13} /> {proposal.error ?? 'The workspace changed since this was proposed.'} Ask again for a fresh proposal.
        </p>
      ) : null}
      {proposalStatus === 'failed' ? (
        <p className="banner banner-error chat-approval-note">{proposal.error ?? 'Execution failed.'}</p>
      ) : null}

      {proposalStatus === 'cancelled' ? null : (
        <div className="chat-approval-body">
          {isDone
            ? orderedReceipts.map((receipt) => <ActionResult key={receipt.actionIndex} receipt={receipt} />)
            : preview.steps.map((step) => <ActionPreview key={step.id} step={step} />)}
        </div>
      )}

      {isPending && preview.warnings.length ? (
        <div className="chat-approval-warnings">
          {preview.warnings.map((warning, index) => (
            <p key={index} className="chat-approval-warning">{warning}</p>
          ))}
        </div>
      ) : null}

      {proposalStatus === 'executing' ? (
        <p className="chat-approval-note">
          <Loader2 size={13} className="chat-spin" /> Running step {Math.min(receipts.length + 1, preview.steps.length)} of {preview.steps.length}…
        </p>
      ) : null}

      {!isDone && proposalStatus !== 'cancelled' ? (
        <details className="chat-approval-source">
          <summary>Show ThreadScript</summary>
          <pre>{proposal.source}</pre>
        </details>
      ) : null}

      {isPending && canAuto ? (
        <p className="chat-approval-auto">Approved automatically — trusted action. Manage in Settings.</p>
      ) : isPending && gateOpen ? (
        <div className="chat-approval-actions">
          <button type="button" className="btn btn-ghost btn-sm chat-approval-deny" disabled={busy} onClick={cancel}>Deny</button>
          {risk === 'write' ? (
            <button type="button" className="btn btn-ghost btn-sm chat-approval-always" disabled={busy} onClick={alwaysAllow}>Always allow</button>
          ) : null}
          <button type="button" className="btn btn-solid btn-sm chat-approval-allow" disabled={busy} onClick={runConfirm}>Allow once</button>
        </div>
      ) : null}
    </div>
  )
}
