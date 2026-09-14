import { useId, useRef, type HTMLAttributes, type ReactNode, type RefObject } from 'react'
import { useManagedLayer } from './layerUtils'

export interface DialogProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> {
  open: boolean
  onOpenChange?: (open: boolean) => void
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  closeLabel?: string
  initialFocusRef?: RefObject<HTMLElement | null>
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
}

/** Centered modal with focus containment, Escape, backdrop dismissal, and focus return. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  closeLabel = 'Close dialog',
  initialFocusRef,
  closeOnBackdrop = true,
  closeOnEscape = true,
  className,
  ...rest
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const id = useId().replaceAll(':', '')
  const titleId = `fiber-dialog-title-${id}`
  const descriptionId = `fiber-dialog-description-${id}`
  useManagedLayer(open, dialogRef, () => onOpenChange?.(false), { closeOnEscape, initialFocusRef })

  if (!open) return null

  return (
    <div
      className="layer-backdrop layer-backdrop-center layer-backdrop-blur"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onOpenChange?.(false)
      }}
    >
      <div
        ref={dialogRef}
        className={['dialog', className].filter(Boolean).join(' ')}
        {...rest}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        aria-label={title ? undefined : 'Dialog'}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {(title || description) ? (
          <header className="dialog-header">
            {title ? <h2 id={titleId}>{title}</h2> : null}
            {description ? <p id={descriptionId}>{description}</p> : null}
          </header>
        ) : null}
        <button type="button" className="dialog-close" aria-label={closeLabel} onClick={() => onOpenChange?.(false)}>×</button>
        <div className="dialog-body">{children}</div>
        {footer ? <footer className="dialog-footer">{footer}</footer> : null}
      </div>
    </div>
  )
}
