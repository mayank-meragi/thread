import { Plus } from 'lucide-react'
import type { ChatSessionRecord } from '../../db'

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function SessionList({
  sessions,
  activeSessionId,
  onSelect,
  onCreate,
}: {
  sessions: ChatSessionRecord[]
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
  onCreate: () => void
}) {
  return (
    <div className="session-list">
      <button type="button" className="session-list-new" onClick={onCreate}>
        <Plus size={13} /> New session
      </button>
      {sessions.map((session) => (
        <button
          key={session.id}
          type="button"
          className={session.id === activeSessionId ? 'session-row active' : 'session-row'}
          onClick={() => onSelect(session.id)}
        >
          <span className="session-row-title">{session.title}</span>
          <small>{relativeTime(session.updatedAt)}</small>
        </button>
      ))}
      {sessions.length === 0 && <p className="empty-hint">No sessions yet.</p>}
    </div>
  )
}
