import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { X } from 'lucide-react'

type ChipAccent = 'thread' | 'task' | 'idea' | 'question' | 'decision' | 'danger' | 'neutral'

interface ChipBaseProps {
  accent?: ChipAccent
  icon?: ReactNode
  children: ReactNode
  className?: string
}

interface ChipStaticProps extends ChipBaseProps {
  interactive?: false
}

interface ChipInteractiveProps extends ChipBaseProps {
  interactive: true
  onRemove?: () => void
  buttonProps?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>
}

export type ChipProps = ChipStaticProps | ChipInteractiveProps

const accentClass: Record<ChipAccent, string> = {
  thread: 'chip-thread',
  task: 'chip-task',
  idea: 'chip-idea',
  question: 'chip-question',
  decision: 'chip-decision',
  danger: 'chip-danger',
  neutral: '',
}

/** Semantic chip primitive — consolidates priority-chip / tab-chip* patterns. */
export function Chip(props: ChipProps) {
  const { accent = 'neutral', icon, children, className } = props
  const classes = ['chip', accentClass[accent], props.interactive ? 'chip-interactive' : '', className]
    .filter(Boolean)
    .join(' ')

  if (props.interactive) {
    return (
      <button type="button" className={classes} {...props.buttonProps}>
        {icon}
        <span>{children}</span>
        {props.onRemove ? (
          <span
            className="chip-remove"
            role="button"
            tabIndex={-1}
            aria-label="Remove"
            onClick={(event) => {
              event.stopPropagation()
              props.onRemove?.()
            }}
          >
            <X size={11} aria-hidden="true" />
          </span>
        ) : null}
      </button>
    )
  }

  return (
    <span className={classes}>
      {icon}
      <span>{children}</span>
    </span>
  )
}
