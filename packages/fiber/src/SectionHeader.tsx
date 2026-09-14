import type { HTMLAttributes, ReactNode } from 'react'

export interface SectionHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
  /** The section label or heading. Pass a heading element when the section needs document outline semantics. */
  title: ReactNode
  description?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  density?: 'compact' | 'default' | 'comfortable'
}

/** Compact title, metadata, and action alignment for repeated page sections. */
export function SectionHeader({
  title,
  description,
  meta,
  actions,
  density,
  className,
  ...rest
}: SectionHeaderProps) {
  return (
    <div className={['section-header', className].filter(Boolean).join(' ')} {...rest} data-density={density}>
      <div className="section-header-main">
        <div className="section-header-title">{title}</div>
        {description ? <div className="section-header-description">{description}</div> : null}
      </div>
      {meta || actions ? (
        <div className="section-header-trailing">
          {meta ? <small className="section-header-meta">{meta}</small> : null}
          {actions ? <div className="section-header-actions">{actions}</div> : null}
        </div>
      ) : null}
    </div>
  )
}
