import { useId, useRef, type HTMLAttributes, type ReactNode, type RefObject } from 'react'
import { useManagedLayer } from './layerUtils'

export type SheetSide = 'start' | 'end' | 'bottom'

export interface SheetProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> {
  open: boolean
  onOpenChange?: (open: boolean) => void
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  side?: SheetSide
  closeLabel?: string
  initialFocusRef?: RefObject<HTMLElement | null>
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
}

/** Edge-anchored responsive layer sharing dialog semantics and focus management. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = 'end',
  closeLabel = 'Close panel',
  initialFocusRef,
  closeOnBackdrop = true,
  closeOnEscape = true,
  className,
  ...rest
}: SheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const id = useId().replaceAll(':', '')
  const titleId = `fiber-sheet-title-${id}`
  const descriptionId = `fiber-sheet-description-${id}`
  useManagedLayer(open, sheetRef, () => onOpenChange?.(false), { closeOnEscape, initialFocusRef })

  if (!open) return null

  return (
    <div
      className={['layer-backdrop', side === 'bottom' ? 'layer-backdrop-bottom' : 'layer-backdrop-end', 'layer-backdrop-blur'].join(' ')}
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onOpenChange?.(false)
      }}
    >
      <div
        ref={sheetRef}
        className={['sheet', `sheet-${side}`, className].filter(Boolean).join(' ')}
        {...rest}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        aria-label={title ? undefined : 'Panel'}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {(title || description) ? (
          <header className="sheet-header">
            {title ? <h2 id={titleId}>{title}</h2> : null}
            {description ? <p id={descriptionId}>{description}</p> : null}
          </header>
        ) : null}
        <button type="button" className="sheet-close" aria-label={closeLabel} onClick={() => onOpenChange?.(false)}>×</button>
        <div className="sheet-body">{children}</div>
        {footer ? <footer className="sheet-footer">{footer}</footer> : null}
      </div>
    </div>
  )
}
