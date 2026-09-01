import { Check, X } from 'lucide-react'
import type { ChatProposalReceipt } from '../../db'

function summarize(receipt: ChatProposalReceipt): string {
  if (receipt.status === 'failed') return receipt.error ?? 'Failed'
  const output = receipt.output as Record<string, unknown> | undefined
  if (!output) return 'Done'
  if ('created' in output) {
    const label = String(output.thread ?? output.property ?? '')
    return output.created === true ? `Created “${label}”` : `Used existing “${label}”`
  }
  if ('changed' in output) {
    if (output.changed === false) return 'No change'
    if ('persona' in output) return 'Journal note added'
    return 'Updated'
  }
  return 'Done'
}

export function ActionResult({ receipt }: { receipt: ChatProposalReceipt }) {
  const failed = receipt.status === 'failed'
  return (
    <div className={failed ? 'chat-proposal-result chat-proposal-result-failed' : 'chat-proposal-result'}>
      {failed ? <X size={13} /> : <Check size={13} />}
      <code>{receipt.capability}</code>
      <span>{summarize(receipt)}</span>
    </div>
  )
}
