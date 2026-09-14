import type { HTMLAttributes, ReactNode } from 'react'

export type FormLayoutColumns = 1 | 2 | 3

export interface FormLayoutProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode
  columns?: FormLayoutColumns
  density?: 'compact' | 'default' | 'comfortable'
}

/** Responsive field grid with one predictable rhythm across feature forms. */
export function FormLayout({ children, columns = 1, density, className, ...rest }: FormLayoutProps) {
  return (
    <div
      className={['form-layout', `form-layout-${columns}`, className].filter(Boolean).join(' ')}
      data-density={density}
      {...rest}
    >
      {children}
    </div>
  )
}
