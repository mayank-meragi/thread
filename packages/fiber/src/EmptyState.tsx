import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  hint?: ReactNode
  className?: string
}

/** Icon/title/hint empty-state primitive. */
export function EmptyState({ icon, title, hint, className }: EmptyStateProps) {
  return (
    <div className={['empty-state', className].filter(Boolean).join(' ')}>
      {icon ? <div className="empty-state-icon">{icon}</div> : null}
      <h2 className="empty-state-title">{title}</h2>
      {hint ? <p className="empty-state-hint">{hint}</p> : null}
    </div>
  )
}
