import { type HTMLAttributes, type ReactNode } from 'react'

export type AlertVariant = 'info' | 'success' | 'warning' | 'error'

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> {
  variant?: AlertVariant
  title?: ReactNode
  children: ReactNode
  action?: ReactNode
  icon?: ReactNode
  dismissible?: boolean
  onDismiss?: () => void
  closeLabel?: string
}

/** Persistent feedback with tone-specific live-region semantics. */
export function Alert({
  variant = 'info',
  title,
  children,
  action,
  icon,
  dismissible,
  onDismiss,
  closeLabel = 'Dismiss alert',
  className,
  ...rest
}: AlertProps) {
  const assertive = variant === 'warning' || variant === 'error'
  const showDismiss = dismissible ?? Boolean(onDismiss)
  return (
    <div
      className={['alert', `alert-${variant}`, className].filter(Boolean).join(' ')}
      {...rest}
      role={rest.role ?? (assertive ? 'alert' : 'status')}
      aria-live={rest['aria-live'] ?? (assertive ? 'assertive' : 'polite')}
    >
      {icon ? <span className="alert-icon" aria-hidden="true">{icon}</span> : null}
      <div className="alert-copy">
        {title ? <strong className="alert-title">{title}</strong> : null}
        <div className="alert-message">{children}</div>
      </div>
      {action ? <div className="alert-action">{action}</div> : null}
      {showDismiss && onDismiss ? <button type="button" className="alert-dismiss" aria-label={closeLabel} onClick={onDismiss}>×</button> : null}
    </div>
  )
}
