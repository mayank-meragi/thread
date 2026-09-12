import { forwardRef, type ReactNode } from 'react'
import { Button, type ButtonProps } from './Button'

export interface MenuItemProps extends Omit<ButtonProps, 'children' | 'className' | 'role'> {
  children: ReactNode
  className?: string
  role?: 'menuitem' | 'option'
}

/** Menu action with the shared menu-item sizing, focus, and disabled states. */
export const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(function MenuItem(
  { children, className, role = 'menuitem', ...rest },
  ref,
) {
  return <Button ref={ref} unstyled role={role} className={['menu-item', className].filter(Boolean).join(' ')} {...rest}>{children}</Button>
})
