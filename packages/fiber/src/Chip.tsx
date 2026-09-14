import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'

export type ChipAccent = 'thread' | 'task' | 'idea' | 'question' | 'decision' | 'danger' | 'neutral'

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
    if (props.onRemove) {
      return (
        <span className={['chip', accentClass[accent], 'chip-token', className].filter(Boolean).join(' ')}>
          {icon}
          <span>{children}</span>
          <Button unstyled type="button" className="chip-remove" aria-label="Remove" {...props.buttonProps} onClick={props.onRemove}>
            <X size={11} aria-hidden="true" />
          </Button>
        </span>
      )
    }

    return (
      <Button unstyled type="button" className={classes} {...props.buttonProps}>
        {icon}
        <span>{children}</span>
      </Button>
    )
  }

  return (
    <span className={classes}>
      {icon}
      <span>{children}</span>
    </span>
  )
}

export type TagProps = ChipBaseProps
export function Tag(props: TagProps) {
  return <Chip {...props} interactive={false} />
}

export type StatusProps = ChipBaseProps
export function Status(props: StatusProps) {
  return <Chip {...props} interactive={false} />
}

export interface FilterChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>, ChipBaseProps {
  pressed?: boolean
}
export function FilterChip({ pressed = false, icon, children, accent = 'neutral', className, ...rest }: FilterChipProps) {
  return (
    <Button
      unstyled
      type="button"
      className={['chip', accentClass[accent], 'chip-filter', className].filter(Boolean).join(' ')}
      aria-pressed={pressed}
      data-pressed={pressed || undefined}
      {...rest}
    >
      {icon}
      <span>{children}</span>
    </Button>
  )
}

export interface TokenProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'>, ChipBaseProps {
  onRemove: () => void
  removeLabel?: string
}
export function Token({ onRemove, removeLabel = 'Remove', icon, children, accent = 'neutral', className, ...rest }: TokenProps) {
  return (
    <span className={['chip', accentClass[accent], 'chip-token', className].filter(Boolean).join(' ')} {...rest}>
      {icon}
      <span>{children}</span>
      <Button unstyled type="button" className="chip-remove" aria-label={removeLabel} onClick={onRemove}>
        <X size={11} aria-hidden="true" />
      </Button>
    </span>
  )
}
