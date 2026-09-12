import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { Spinner } from './Spinner'

export type ButtonVariant = 'solid' | 'accent' | 'outline' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  iconOnly?: boolean
  /** Preserve a specialized control's existing visual treatment while centralizing button behavior. */
  unstyled?: boolean
}

const sizeClass: Record<ButtonSize, string> = { sm: 'btn-sm', md: '', lg: 'btn-lg' }

function buttonClasses(variant: ButtonVariant, size: ButtonSize, iconOnly: boolean, loading: boolean, className?: string, unstyled = false) {
  if (unstyled) return [loading ? 'btn-loading' : '', className].filter(Boolean).join(' ')

  return ['btn', `btn-${variant}`, sizeClass[size], iconOnly ? 'btn-icon' : '', loading ? 'btn-loading' : '', className]
    .filter(Boolean)
    .join(' ')
}

/** Shared button primitive — consolidates the repo's ad hoc button selectors. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'solid', size = 'md', loading = false, iconOnly = false, unstyled = false, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  const classes = buttonClasses(variant, size, iconOnly, loading, className, unstyled)

  return (
    <button
      ref={ref}
      type={type}
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

export interface ButtonLinkProps extends Omit<LinkProps, 'className' | 'children'> {
  variant?: ButtonVariant
  size?: ButtonSize
  iconOnly?: boolean
  className?: string
  children?: React.ReactNode
}

/** Router-aware button primitive for navigation actions styled like buttons. */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant = 'solid', size = 'md', iconOnly = false, className, children, ...rest },
  ref,
) {
  return (
    <Link ref={ref} className={buttonClasses(variant, size, iconOnly, false, className)} {...rest}>
      {children}
    </Link>
  )
})
