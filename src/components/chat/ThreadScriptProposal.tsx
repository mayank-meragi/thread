import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { db } from '../../db'
import { dispatchApprovedProposal } from '../../lib/threadscript/dispatch'
import { cancelProposal } from '../../lib/threadscript/proposals'
import { ActionPreview } from './ActionPreview'
import { ActionResult } from './ActionResult'

export function ThreadScriptProposal({ proposalId }: { proposalId: string }) {
  const proposal = useLiveQuery(() => db.chatProposals.get(proposalId), [proposalId])
  const [busy, setBusy] = useState(false)

  if (!proposal) return <div className="chat-proposal chat-proposal-loading">Loading proposal…</div>

  const { status, preview, risk, receipts } = proposal
  const orderedReceipts = [...receipts].sort((a, b) => a.actionIndex - b.actionIndex)

  const confirm = async () => {
    setBusy(true)
    try {
      await dispatchApprovedProposal(proposalId)
    } finally {
      setBusy(false)
    }
  }
  const cancel = async () => {
    setBusy(true)
    try {
      await cancelProposal(proposalId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`chat-proposal chat-proposal-${status}`}>
      <div className="chat-proposal-header">
        <span className={`chat-proposal-risk chat-proposal-risk-${risk}`}>{risk}</span>
        <span className="chat-proposal-title">{preview.description ?? 'ThreadScript proposal'}</span>
        <span className="chat-proposal-status">{status}</span>
      </div>

      {status === 'stale' ? (
        <p className="chat-proposal-stale">
          <AlertTriangle size={13} /> {proposal.error ?? 'The workspace changed since this was proposed.'} Ask again for a fresh proposal.
        </p>
      ) : null}
      {status === 'failed' ? (
        <p className="banner banner-error chat-proposal-failed">{proposal.error ?? 'Execution failed.'}</p>
      ) : null}

      {status === 'completed' || status === 'failed' ? (
        <div className="chat-proposal-results">
          {orderedReceipts.map((receipt) => (
            <ActionResult key={receipt.actionIndex} receipt={receipt} />
          ))}
        </div>
      ) : status === 'cancelled' ? null : (
        <div className="chat-proposal-steps">
          {preview.steps.map((step) => (
            <ActionPreview key={step.id} step={step} />
          ))}
        </div>
      )}

      {status === 'pending' && preview.warnings.length ? (
        <div className="chat-proposal-warnings">
          {preview.warnings.map((warning, index) => (
            <p key={index} className="chat-proposal-warning">{warning}</p>
          ))}
        </div>
      ) : null}

      {status === 'pending' && risk === 'destructive' ? (
        <p className="chat-proposal-danger">
          <AlertTriangle size={13} /> This includes destructive changes that replace or remove existing content.
        </p>
      ) : null}

      {status === 'executing' ? (
        <p className="chat-proposal-executing">
          <Loader2 size={13} className="chat-proposal-spin" /> Running step {Math.min(receipts.length + 1, preview.steps.length)} of {preview.steps.length}…
        </p>
      ) : null}

      <details className="chat-proposal-source">
        <summary>ThreadScript</summary>
        <pre>{proposal.source}</pre>
      </details>

      {status === 'pending' ? (
        <div className="chat-proposal-actions">
          <button type="button" className="chat-proposal-confirm" disabled={busy} onClick={confirm}>Confirm</button>
          <button type="button" className="chat-proposal-cancel" disabled={busy} onClick={cancel}>Cancel</button>
        </div>
      ) : null}
    </div>
  )
}
