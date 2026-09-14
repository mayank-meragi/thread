import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

export interface ListRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title' | 'onClick'> {
  /** Primary row label. Keep it short enough to scan in a dense list. */
  title: ReactNode
  description?: ReactNode
  meta?: ReactNode
  status?: ReactNode
  leading?: ReactNode
  trailing?: ReactNode
  selected?: boolean
  density?: 'compact' | 'default' | 'comfortable'
  /** Renders a native button row with keyboard semantics when provided. */
  onActivate?: () => void
}

/** Dense row layout with optional leading, status, metadata, and actions. */
export function ListRow({
  title,
  description,
  meta,
  status,
  leading,
  trailing,
  selected = false,
  density,
  onActivate,
  className,
  ...rest
}: ListRowProps) {
  const classes = ['list-row', onActivate ? 'list-row-interactive' : '', selected ? 'is-selected' : '', className]
    .filter(Boolean)
    .join(' ')
  const content = (
    <>
      {leading ? <span className="list-row-leading">{leading}</span> : null}
      <span className="list-row-content">
        <span className="list-row-title-line">
          <span className="list-row-title">{title}</span>
          {status ? <span className="list-row-status">{status}</span> : null}
        </span>
        {description ? <span className="list-row-description">{description}</span> : null}
        {meta ? <span className="list-row-meta">{meta}</span> : null}
      </span>
      {trailing ? <span className="list-row-trailing">{trailing}</span> : null}
    </>
  )

  if (onActivate) {
    const buttonProps = rest as ButtonHTMLAttributes<HTMLButtonElement>
    return <button type="button" className={classes} {...buttonProps} onClick={onActivate} data-density={density}>{content}</button>
  }

  return <div className={classes} {...rest} data-density={density}>{content}</div>
}
