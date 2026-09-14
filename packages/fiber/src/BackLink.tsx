import { type AnchorHTMLAttributes, type ReactNode } from 'react'

export interface BackLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  children: ReactNode
  leading?: ReactNode
}

/** A low-emphasis return link that keeps its destination explicit. */
export function BackLink({ children, className, leading = '←', ...rest }: BackLinkProps) {
  return (
    <a className={['back-link', className].filter(Boolean).join(' ')} {...rest}>
      <span className="back-link-leading" aria-hidden="true">{leading}</span>
      <span>{children}</span>
    </a>
  )
}
