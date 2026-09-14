import type { HTMLAttributes, ReactNode } from 'react'

export interface ActionGroupProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode
  density?: 'compact' | 'default' | 'comfortable'
  align?: 'start' | 'center' | 'end'
}

/** Shared rhythm for related actions; it owns spacing, not action priority. */
export function ActionGroup({ children, density, align = 'start', className, ...rest }: ActionGroupProps) {
  return (
    <div
      className={['action-group', `action-group-${align}`, className].filter(Boolean).join(' ')}
      {...rest}
      data-density={density}
    >
      {children}
    </div>
  )
}
