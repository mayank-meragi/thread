import { forwardRef, type ReactNode } from 'react'
import { Button, type ButtonProps } from './Button'

export interface MenuItemProps extends Omit<ButtonProps, 'children' | 'className' | 'role'> {
  children: ReactNode
  className?: string
  role?: 'menuitem' | 'option'
  leading?: ReactNode
  description?: ReactNode
  shortcut?: ReactNode
  trailing?: ReactNode
}

/** Menu action with the shared menu-item sizing, focus, and disabled states. */
export const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(function MenuItem(
  { children, className, role = 'menuitem', leading, description, shortcut, trailing, ...rest },
  ref,
){
  const hasSlots = leading || description || shortcut || trailing
  if (!hasSlots) {
    return <Button ref={ref} unstyled role={role} className={['menu-item', className].filter(Boolean).join(' ')} {...rest}>{children}</Button>
  }

  return (
    <Button ref={ref} unstyled role={role} className={['menu-item', 'menu-item-slotted', className].filter(Boolean).join(' ')} {...rest}>
      {leading ? <span className="menu-item-leading" aria-hidden="true">{leading}</span> : null}
      <span className="menu-item-copy">
        <span className="menu-item-label">{children}</span>
        {description ? <small className="menu-item-description">{description}</small> : null}
      </span>
      {shortcut || trailing ? <span className="menu-item-trailing">{shortcut ? <kbd>{shortcut}</kbd> : null}{trailing}</span> : null}
    </Button>
  )
})
