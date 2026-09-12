import { forwardRef, type ReactNode } from 'react'
import { Button, type ButtonProps } from './Button'

export interface ToggleButtonProps extends Omit<ButtonProps, 'children' | 'aria-pressed'> {
  children: ReactNode
  pressed?: boolean
}

/** Button that owns the pressed state contract for view modes and filters. */
export const ToggleButton = forwardRef<HTMLButtonElement, ToggleButtonProps>(function ToggleButton(
  { pressed, children, className, ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      className={['toggle-button', className].filter(Boolean).join(' ')}
      aria-pressed={pressed}
      data-pressed={pressed || undefined}
      {...rest}
    >
      {children}
    </Button>
  )
})
