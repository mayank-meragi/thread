import { type HTMLAttributes, type ReactNode } from 'react'

export interface ToolbarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode
  density?: 'compact' | 'default' | 'comfortable'
  orientation?: 'horizontal' | 'vertical'
  label?: string
}

/** Shared alignment rail for actions, filters, and view controls. */
export function Toolbar({
  children,
  className,
  density,
  label,
  orientation = 'horizontal',
  ...rest
}: ToolbarProps) {
  return (
    <div
      className={['toolbar', `toolbar-${orientation}`, className].filter(Boolean).join(' ')}
      {...rest}
      role="toolbar"
      aria-label={label ?? rest['aria-label']}
      aria-orientation={orientation}
      data-density={density}
    >
      {children}
    </div>
  )
}
