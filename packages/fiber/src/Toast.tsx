import { useEffect, type HTMLAttributes, type ReactNode } from 'react'

export type ToastVariant = 'info' | 'success' | 'warning' | 'error'

export interface ToastProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> {
  open?: boolean
  variant?: ToastVariant
  title?: ReactNode
  children: ReactNode
  action?: ReactNode
  durationMs?: number
  onDismiss?: () => void
  closeLabel?: string
}

/** Transient async feedback with a polite announcement and optional timeout. */
export function Toast({
  open = true,
  variant = 'info',
  title,
  children,
  action,
  durationMs = 5000,
  onDismiss,
  closeLabel = 'Dismiss notification',
  className,
  ...rest
}: ToastProps) {
  useEffect(() => {
    if (!open || !onDismiss || durationMs <= 0) return
    const timer = window.setTimeout(onDismiss, durationMs)
    return () => window.clearTimeout(timer)
  }, [durationMs, onDismiss, open])

  if (!open) return null

  return (
    <div
      className={['toast', `toast-${variant}`, className].filter(Boolean).join(' ')}
      {...rest}
      role={rest.role ?? 'status'}
      aria-live={rest['aria-live'] ?? 'polite'}
      aria-atomic="true"
    >
      <div className="toast-copy">
        {title ? <strong className="toast-title">{title}</strong> : null}
        <div className="toast-message">{children}</div>
      </div>
      {action ? <div className="toast-action">{action}</div> : null}
      {onDismiss ? <button type="button" className="toast-dismiss" aria-label={closeLabel} onClick={onDismiss}>×</button> : null}
    </div>
  )
}
