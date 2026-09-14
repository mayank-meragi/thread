import { Children, cloneElement, isValidElement, useState, type HTMLAttributes, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { Popover, type PopoverPlacement } from './Popover'

export interface MenuProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  trigger: ReactElement
  children: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  placement?: PopoverPlacement
  label?: string
}

/** Menu behavior layered over the shared popover positioning and dismissal contract. */
export function Menu({
  trigger,
  children,
  open,
  defaultOpen,
  onOpenChange,
  placement = 'bottom-start',
  label = 'Menu',
  className,
  onKeyDown,
  ...rest
}: MenuProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false)
  const menuOpen = open ?? internalOpen
  const handleOpenChange = (nextOpen: boolean) => {
    if (open === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }
  const close = () => handleOpenChange(false)
  const menuChildren = Children.map(children, (child) => {
    if (!isValidElement(child)) return child
    const typedChild = child as ReactElement<Record<string, unknown>>
    const childProps = typedChild.props as { onClick?: (event: React.MouseEvent<HTMLElement>) => void; role?: string }
    return cloneElement(typedChild, {
      role: childProps.role ?? 'menuitem',
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        childProps.onClick?.(event)
        if (!event.defaultPrevented) close()
      },
    } as Partial<Record<string, unknown>>)
  })

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"]):not([disabled])'))
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      ;(event.key === 'Home' ? items[0] : items[items.length - 1])?.focus()
    } else if (direction && items.length) {
      event.preventDefault()
      const index = Math.max(0, items.indexOf(document.activeElement as HTMLElement))
      items[(index + direction + items.length) % items.length]?.focus()
    }
    onKeyDown?.(event)
  }

  return (
    <Popover
      trigger={trigger}
      open={menuOpen}
      onOpenChange={handleOpenChange}
      placement={placement}
      modal
      contentRole="menu"
      className={['menu-panel', className].filter(Boolean).join(' ')}
      aria-label={label}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      {menuChildren}
    </Popover>
  )
}
