import { type HTMLAttributes } from 'react'

export interface ProgressProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  value?: number
  max?: number
  label?: string
  showValue?: boolean
  size?: 'sm' | 'md'
}

/** Measurable or indeterminate progress with a stable progressbar contract. */
export function Progress({ value, max = 100, label, showValue = false, size = 'md', className, ...rest }: ProgressProps) {
  const determinate = typeof value === 'number' && Number.isFinite(value)
  const percentage = determinate ? Math.min(100, Math.max(0, (value / max) * 100)) : undefined
  return (
    <div className={['progress-wrap', `progress-${size}`, className].filter(Boolean).join(' ')} {...rest}>
      {label || (showValue && determinate) ? (
        <div className="progress-label">
          {label ? <span>{label}</span> : <span />}
          {showValue && determinate ? <span>{Math.round(percentage ?? 0)}%</span> : null}
        </div>
      ) : null}
      <div
        className="progress"
        role="progressbar"
        aria-label={label ?? 'Progress'}
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuemax={determinate ? max : undefined}
        aria-valuenow={determinate ? value : undefined}
        aria-valuetext={determinate ? `${Math.round(percentage ?? 0)}%` : 'Loading'}
        data-indeterminate={!determinate || undefined}
      >
        <span className="progress-bar" style={percentage === undefined ? undefined : { width: `${percentage}%` }} />
      </div>
    </div>
  )
}
