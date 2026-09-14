import type { ReactNode } from 'react'

export type EmptyStateVariant = 'inline' | 'panel' | 'page'

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  hint?: ReactNode
  action?: ReactNode
  variant?: EmptyStateVariant
  className?: string
}

/** Icon/title/hint empty-state primitive. */
export function EmptyState({ icon, title, hint, action, variant = 'page', className }: EmptyStateProps) {
  return (
    <div className={['empty-state', `empty-state-${variant}`, className].filter(Boolean).join(' ')}>
      {icon ? <div className="empty-state-icon">{icon}</div> : null}
      <h2 className="empty-state-title">{title}</h2>
      {hint ? <p className="empty-state-hint">{hint}</p> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  )
}
