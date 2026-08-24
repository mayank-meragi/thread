import { Loader2 } from 'lucide-react'

interface SpinnerProps {
  size?: number
  label?: string
  className?: string
}

/** Inline loading indicator built on the shared `spin` keyframe (primitives.css). */
export function Spinner({ size = 16, label, className }: SpinnerProps) {
  return (
    <span className={['spin', className].filter(Boolean).join(' ')} role="status" aria-label={label ?? 'Loading'}>
      <Loader2 size={size} aria-hidden="true" />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  )
}
