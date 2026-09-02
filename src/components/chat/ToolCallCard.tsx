import { BookOpen, Database, Loader2, SpellCheck } from 'lucide-react'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'

type ToolName = 'threadScriptHelp' | 'validateThreadScript' | 'inspectTql'

const RUNNING_LABEL: Record<ToolName, string> = {
  threadScriptHelp: 'Looking up ThreadScript help…',
  validateThreadScript: 'Validating ThreadScript…',
  inspectTql: 'Running query…',
}

const ICON: Record<ToolName, typeof BookOpen> = {
  threadScriptHelp: BookOpen,
  validateThreadScript: SpellCheck,
  inspectTql: Database,
}

function summarize(toolName: ToolName, result: unknown): string {
  const value = (result ?? {}) as Record<string, unknown>
  if (toolName === 'threadScriptHelp') {
    const commands = Array.isArray(value.commands) ? value.commands.length : 0
    return commands ? `Help · ${commands} command${commands === 1 ? '' : 's'}` : 'Looked up ThreadScript help'
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

// Compact status card for the read-only ThreadScript tools (help / validate /
// inspect). Renders running -> complete -> error off the assistant-ui tool-call
// part status.
export function ToolCallCard({ toolName, status, result }: ToolCallMessagePartProps) {
  const name = toolName as ToolName
  const Icon = ICON[name] ?? Database

  if (status.type === 'running') {
    return (
      <div className="chat-toolcall-card">
        <Loader2 size={13} className="chat-proposal-spin" />
        <span>{RUNNING_LABEL[name] ?? 'Working…'}</span>
      </div>
    )
  }

  if (status.type === 'incomplete') {
    return (
      <div className="chat-toolcall-card chat-toolcall-card-error">
        <Icon size={13} />
        <span>{name} failed{status.reason ? ` (${status.reason})` : ''}</span>
      </div>
    )
  }

  return (
    <div className="chat-toolcall-card">
      <Icon size={13} />
      <span>{summarize(name, result)}</span>
    </div>
  )
}
