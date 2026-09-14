import { cloneElement, useCallback, useEffect, useRef, useState, type HTMLAttributes, type ReactElement, type ReactNode, type RefObject } from 'react'
import { useManagedLayer } from './layerUtils'

export type PopoverPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'

export interface PopoverProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  trigger: ReactElement
  children: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  placement?: PopoverPlacement
  modal?: boolean
  contentRole?: string
  initialFocusRef?: RefObject<HTMLElement | null>
}

/** Controlled/uncontrolled popover with outside-click, Escape, and focus return behavior. */
export function Popover({
  trigger,
  children,
  open,
  defaultOpen = false,
  onOpenChange,
  placement = 'bottom-start',
  modal = false,
  contentRole,
  initialFocusRef,
  className,
  ...rest
}: PopoverProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const isOpen = open ?? internalOpen
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const contentNodeRef = useRef<HTMLDivElement | null>(null)

  const setOpen = useCallback((nextOpen: boolean) => {
    if (open === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }, [onOpenChange, open])

  useManagedLayer(isOpen, contentNodeRef, () => setOpen(false), {
    focusOnOpen: modal,
    initialFocusRef,
    trapFocus: modal,
  })

  useEffect(() => {
    if (!isOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isOpen, setOpen])

  const resolvedRole = contentRole ?? (modal ? 'dialog' : 'region')
  const enhancedTrigger = cloneElement(trigger, {
    'aria-haspopup': (trigger.props as { 'aria-haspopup'?: string })['aria-haspopup'] ?? (resolvedRole === 'menu' ? 'menu' : resolvedRole === 'listbox' ? 'listbox' : 'dialog'),
    'aria-expanded': isOpen,
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      ;(trigger.props as { onClick?: React.MouseEventHandler<HTMLElement> }).onClick?.(event)
      if (!event.defaultPrevented) setOpen(!isOpen)
    },
  } as Partial<Record<string, unknown>>) as ReactElement

  return (
    <span ref={rootRef} className="popover-root">
      <span className="popover-trigger">{enhancedTrigger}</span>
      {isOpen ? (
        <div
          ref={contentNodeRef}
          className={['popover', `popover-${placement}`, className].filter(Boolean).join(' ')}
          {...rest}
          role={resolvedRole}
          tabIndex={modal ? -1 : undefined}
          aria-modal={modal && (resolvedRole === 'dialog' || resolvedRole === 'alertdialog') ? 'true' : undefined}
          data-placement={placement}
        >
          {children}
        </div>
      ) : null}
    </span>
  )
}
