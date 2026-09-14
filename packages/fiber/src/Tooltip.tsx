import { cloneElement, useId, type HTMLAttributes, type ReactElement, type ReactNode } from 'react'

export type TooltipSide = 'top' | 'right' | 'bottom' | 'left'

type TooltipTriggerProps = {
  className?: string
  'aria-describedby'?: string
}

export interface TooltipProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'content'> {
  /** Short, useful context for the control under the pointer or keyboard focus. */
  content: ReactNode
  /** Exactly one interactive or focusable trigger element. */
  children: ReactElement<TooltipTriggerProps>
  side?: TooltipSide
}

/** Accessible hover/focus context that keeps the trigger's native semantics intact. */
export function Tooltip({ content, children, side = 'top', className, ...rest }: TooltipProps) {
  const generatedId = useId().replace(/:/g, '')
  if (content === null || content === undefined || content === false) return children

  const tooltipId = `fiber-tooltip-${generatedId}`
  const existingDescribedBy = children.props['aria-describedby']
  const describedBy = [existingDescribedBy, tooltipId].filter(Boolean).join(' ')
  const trigger = cloneElement(children, {
    className: [children.props.className, 'tooltip-trigger'].filter(Boolean).join(' '),
    'aria-describedby': describedBy,
  })

  return (
    <span className={['tooltip', className].filter(Boolean).join(' ')} data-side={side} {...rest}>
      {trigger}
      <span className="tooltip-content" id={tooltipId} role="tooltip">{content}</span>
    </span>
  )
}
