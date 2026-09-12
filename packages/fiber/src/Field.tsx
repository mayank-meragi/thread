import { useId, type HTMLAttributes, type ReactNode } from 'react'
import { fieldContext } from './fieldContext'

export interface FieldProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  controlId?: string
  required?: boolean
}

/** Label + control + hint/error recipe with shared accessibility wiring. */
export function Field({
  children,
  label,
  hint,
  error,
  controlId,
  required = false,
  className,
  ...rest
}: FieldProps) {
  const generatedId = useId().replace(/:/g, '')
  const resolvedControlId = controlId ?? `fiber-field-${generatedId}`
  const hasError = Boolean(error)
  const hintId = hint && !hasError ? `${resolvedControlId}-hint` : undefined
  const errorId = hasError ? `${resolvedControlId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <fieldContext.Provider value={{ controlId: resolvedControlId, describedBy, invalid: hasError, required }}>
      <div className={['field', hasError ? 'field-error' : '', className].filter(Boolean).join(' ')} {...rest}>
        {label ? <label className="field-label" htmlFor={resolvedControlId}>{label}{required ? <span className="field-required" aria-hidden="true"> *</span> : null}</label> : null}
        {children}
        {hintId ? <p className="field-hint" id={hintId}>{hint}</p> : null}
        {errorId ? <p className="field-hint field-hint-error" id={errorId} role="alert">{error}</p> : null}
      </div>
    </fieldContext.Provider>
  )
}
