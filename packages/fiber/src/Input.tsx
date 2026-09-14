import { forwardRef, type InputHTMLAttributes } from 'react'
import { useFieldContext } from './fieldContext'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Mark the control invalid without needing a surrounding Field. */
  invalid?: boolean
}

/** Text input primitive that composes with Field's id, hint, and error wiring. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, id, invalid, required, readOnly, 'aria-describedby': ariaDescribedBy, 'aria-invalid': ariaInvalid, ...rest },
  ref,
) {
  const field = useFieldContext()
  const resolvedInvalid = invalid ?? field?.invalid
  const describedBy = [field?.describedBy, ariaDescribedBy].filter(Boolean).join(' ') || undefined

  return (
    <input
      ref={ref}
      id={id ?? field?.controlId}
      className={['field-control', readOnly ? 'field-control-readonly' : '', className].filter(Boolean).join(' ')}
      required={required ?? field?.required}
      readOnly={readOnly}
      aria-describedby={describedBy}
      aria-invalid={resolvedInvalid ? true : ariaInvalid}
      aria-readonly={readOnly || undefined}
      {...rest}
    />
  )
})
