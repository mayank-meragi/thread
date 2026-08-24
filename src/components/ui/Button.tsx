import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Spinner } from './Spinner'

type ButtonVariant = 'solid' | 'accent' | 'outline' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

const sizeClass: Record<ButtonSize, string> = { sm: 'btn-sm', md: '', lg: 'btn-lg' }

/** Shared button primitive — consolidates the repo's ad hoc button selectors. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'solid', size = 'md', loading = false, disabled, className, children, ...rest },
  ref,
) {
  const classes = ['btn', `btn-${variant}`, sizeClass[size], loading ? 'btn-loading' : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      ref={ref}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {children}
      {loading ? <Spinner className="btn-spinner" size={size === 'sm' ? 13 : 15} /> : null}
    </button>
  )
})
