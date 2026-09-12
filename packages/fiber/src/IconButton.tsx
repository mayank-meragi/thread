import { forwardRef, type ReactNode } from 'react'
import { Button, type ButtonProps } from './Button'

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'iconOnly'> {
  children: ReactNode
  /** Icon-only controls must always expose a spoken label. */
  'aria-label': string
}

/** Shared icon-only action with a consistent hit target and accessible label. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { children, className, ...rest },
  ref,
) {
  return <Button ref={ref} iconOnly className={className} {...rest}>{children}</Button>
})
