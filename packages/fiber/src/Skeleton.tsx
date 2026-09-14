import { type CSSProperties, type HTMLAttributes } from 'react'

export interface SkeletonProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  variant?: 'text' | 'block' | 'circle'
  lines?: number
  width?: CSSProperties['width']
  height?: CSSProperties['height']
}

/** Restrained loading placeholder that remains invisible to assistive technology. */
export function Skeleton({ variant = 'text', lines = 1, width, height, className, style, ...rest }: SkeletonProps) {
  const count = Math.max(1, Math.floor(lines))
  const lineStyle = { width, height, ...style }
  return (
    <span
      className={['skeleton', `skeleton-${variant}`, className].filter(Boolean).join(' ')}
      {...rest}
      aria-hidden="true"
      style={lineStyle}
    >
      {Array.from({ length: count }, (_, index) => <span key={index} className="skeleton-line" />)}
    </span>
  )
}
