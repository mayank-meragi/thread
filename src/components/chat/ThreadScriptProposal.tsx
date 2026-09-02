import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, FileCheck, Loader2 } from 'lucide-react'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { db } from '../../db'
import { dispatchApprovedProposal } from '../../lib/threadscript/dispatch'
import { cancelProposal } from '../../lib/threadscript/proposals'
import { ActionPreview } from './ActionPreview'
import { ActionResult } from './ActionResult'

type ProposeResult = {
  created?: boolean
  proposalId?: string
  diagnostics?: Array<{ message: string }>
}

// Renders the `proposeThreadScript` tool call. The tool never executes a
// workspace change -- it drafts a pending `chatProposals` row and pauses the
// turn on an assistant-ui approval gate. Confirm/Cancel here run the trusted
// dispatcher / cancel, then resolve the gate so the runtime ends the turn.
export function ThreadScriptProposal({ status, result, approval, respondToApproval }: ToolCallMessagePartProps<{ source?: string }, ProposeResult>) {
  const proposalId = approval?.id ?? result?.proposalId ?? null
  const proposal = useLiveQuery(() => (proposalId ? db.chatProposals.get(proposalId) : undefined), [proposalId])
  const [busy, setBusy] = useState(false)

  // Draft still in flight, or it failed to compile/resolve (no proposal row).
  if (!proposalId) {
    if (status.type === 'running') {
      return (
        <div className="chat-tool-call">
          <Loader2 size={13} className="chat-proposal-spin" />
          <span>Drafting a proposal…</span>
        </div>
      )
    }
    return (
      <div className="chat-tool-call">
        <FileCheck size={13} />
        <span>Draft failed: {result?.diagnostics?.[0]?.message ?? 'invalid script'}</span>
      </div>
    )
  }

  if (!proposal) return <div className="chat-proposal chat-proposal-loading">Loading proposal…</div>

  const { status: proposalStatus, preview, risk, receipts } = proposal
  const orderedReceipts = [...receipts].sort((a, b) => a.actionIndex - b.actionIndex)
  const gateOpen = Boolean(respondToApproval) && approval?.approved === undefined

  const confirm = async () => {
    setBusy(true)
    try {
      await dispatchApprovedProposal(proposalId)
      if (gateOpen) respondToApproval!({ approved: true })
    } finally {
      setBusy(false)
    }
  }
  const cancel = async () => {
    setBusy(true)
    try {
      await cancelProposal(proposalId)
      if (gateOpen) respondToApproval!({ approved: false, reason: 'Declined by user' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`chat-proposal chat-proposal-${proposalStatus}`}>
      <div className="chat-proposal-header">
        <span className={`chat-proposal-risk chat-proposal-risk-${risk}`}>{risk}</span>
        <span className="chat-proposal-title">{preview.description ?? 'ThreadScript proposal'}</span>
        <span className="chat-proposal-status">{proposalStatus}</span>
      </div>

      {proposalStatus === 'stale' ? (
        <p className="chat-proposal-stale">
          <AlertTriangle size={13} /> {proposal.error ?? 'The workspace changed since this was proposed.'} Ask again for a fresh proposal.
        </p>
      ) : null}
      {proposalStatus === 'failed' ? (
        <p className="banner banner-error chat-proposal-failed">{proposal.error ?? 'Execution failed.'}</p>
      ) : null}

      {proposalStatus === 'completed' || proposalStatus === 'failed' ? (
        <div className="chat-proposal-results">
          {orderedReceipts.map((receipt) => (
            <ActionResult key={receipt.actionIndex} receipt={receipt} />
          ))}
        </div>
      ) : proposalStatus === 'cancelled' ? null : (
        <div className="chat-proposal-steps">
          {preview.steps.map((step) => (
            <ActionPreview key={step.id} step={step} />
          ))}
        </div>
      )}

      {proposalStatus === 'pending' && preview.warnings.length ? (
        <div className="chat-proposal-warnings">
          {preview.warnings.map((warning, index) => (
            <p key={index} className="chat-proposal-warning">{warning}</p>
          ))}
        </div>
      ) : null}

      {proposalStatus === 'pending' && risk === 'destructive' ? (
        <p className="chat-proposal-danger">
          <AlertTriangle size={13} /> This includes destructive changes that replace or remove existing content.
        </p>
      ) : null}

      {proposalStatus === 'executing' ? (
        <p className="chat-proposal-executing">
          <Loader2 size={13} className="chat-proposal-spin" /> Running step {Math.min(receipts.length + 1, preview.steps.length)} of {preview.steps.length}…
        </p>
      ) : null}

      <details className="chat-proposal-source">
        <summary>ThreadScript</summary>
        <pre>{proposal.source}</pre>
      </details>

      {proposalStatus === 'pending' ? (
        <div className="chat-proposal-actions">
          <button type="button" className="chat-proposal-confirm" disabled={busy} onClick={confirm}>Confirm</button>
          <button type="button" className="chat-proposal-cancel" disabled={busy} onClick={cancel}>Cancel</button>
        </div>
      ) : null}
    </div>
  )
}
