import { useState } from 'react'
import { Check, ChevronRight, Loader2, X } from 'lucide-react'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'

type ToolName = 'threadScriptHelp' | 'validateThreadScript' | 'inspectTql'

const LABEL: Record<ToolName, string> = {
  threadScriptHelp: 'Looked up ThreadScript help',
  validateThreadScript: 'Checked a ThreadScript',
  inspectTql: 'Ran a query',
}

function argPill(toolName: ToolName, args: unknown): string | null {
  const value = (args ?? {}) as Record<string, unknown>
  if (toolName === 'inspectTql' && typeof value.query === 'string') return value.query
  if (toolName === 'threadScriptHelp' && typeof value.topic === 'string' && value.topic.trim()) return value.topic
  return null
}

function summarize(toolName: ToolName, result: unknown): string {
  const value = (result ?? {}) as Record<string, unknown>
  if (toolName === 'threadScriptHelp') {
    const commands = Array.isArray(value.commands) ? value.commands.length : 0
    return commands ? `${commands} command${commands === 1 ? '' : 's'}` : 'Looked up ThreadScript help'
  }
  if (toolName === 'validateThreadScript') {
    const diagnostics = Array.isArray(value.diagnostics) ? value.diagnostics.length : 0
    if (value.valid) {
      const actions = typeof value.actionCount === 'number' ? value.actionCount : 0
      return `Valid · ${actions} action${actions === 1 ? '' : 's'}`
    }
    return `${diagnostics} diagnostic${diagnostics === 1 ? '' : 's'}`
  }
  const rowCount = typeof value.rowCount === 'number' ? value.rowCount : 0
  return `${rowCount} row${rowCount === 1 ? '' : 's'}${value.truncated ? ' (showing 50)' : ''}`
}

// A collapsible disclosure row for the read-only ThreadScript tools: a
// past-tense label, the key argument as a pill, and a status icon. Expanding it
// shows the raw request args and a one-line result.
export function ToolCallCard({ toolName, status, args, argsText, result }: ToolCallMessagePartProps) {
  const [open, setOpen] = useState(false)
  const name = toolName as ToolName
  const running = status.type === 'running'
  const failed = status.type === 'incomplete'
  const pill = argPill(name, args)

  return (
    <div className="chat-tool">
      <button type="button" className="chat-tool-row" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ChevronRight size={14} className="chat-tool-chevron" data-open={open || undefined} aria-hidden="true" />
        <span className="chat-tool-label">{LABEL[name] ?? toolName}</span>
        {pill ? <span className="chat-tool-arg">{pill}</span> : null}
        <span className="chat-tool-status" data-state={running ? 'running' : failed ? 'error' : 'ok'} aria-hidden="true">
          {running ? <Loader2 size={13} className="chat-spin" /> : failed ? <X size={13} /> : <Check size={13} />}
        </span>
      </button>

      {open ? (
        <div className="chat-tool-detail">
          <div className="chat-tool-detail-label">Request</div>
          <pre className="chat-tool-detail-code">{argsText || JSON.stringify(args ?? {})}</pre>
          {running ? null : (
            <>
              <div className="chat-tool-detail-label chat-tool-detail-divider">Result</div>
              <p className="chat-tool-detail-value">
                {failed ? `Failed${status.reason ? ` (${status.reason})` : ''}` : summarize(name, result)}
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
