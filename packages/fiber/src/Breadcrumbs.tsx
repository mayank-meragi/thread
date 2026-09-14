import { type HTMLAttributes, type ReactNode } from 'react'

export interface BreadcrumbItem {
  label: ReactNode
  href?: string
  current?: boolean
}

export interface BreadcrumbsProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  items: readonly BreadcrumbItem[]
  label?: string
}

/** Compact page hierarchy with an explicit current-page marker. */
export function Breadcrumbs({ items, label = 'Breadcrumb', className, ...rest }: BreadcrumbsProps) {
  return (
    <nav className={['breadcrumbs', className].filter(Boolean).join(' ')} {...rest} aria-label={label}>
      <ol>
        {items.map((item, index) => {
          const current = item.current ?? index === items.length - 1
          return (
            <li key={`${index}-${String(item.label)}`}>
              {current || !item.href ? <span aria-current={current ? 'page' : undefined}>{item.label}</span> : <a href={item.href}>{item.label}</a>}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
