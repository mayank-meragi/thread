import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { useFieldContext } from './fieldContext'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Mark the control invalid without needing a surrounding Field. */
  invalid?: boolean
}

/** Multi-line text primitive that composes with Field labels, hints, and errors. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, id, invalid, required, 'aria-describedby': ariaDescribedBy, 'aria-invalid': ariaInvalid, ...rest },
  ref,
) {
  const field = useFieldContext()
  const resolvedInvalid = invalid ?? field?.invalid
  const describedBy = [field?.describedBy, ariaDescribedBy].filter(Boolean).join(' ') || undefined

  return (
    <textarea
      ref={ref}
      id={id ?? field?.controlId}
      className={['field-control', 'field-textarea', className].filter(Boolean).join(' ')}
      required={required ?? field?.required}
      aria-describedby={describedBy}
      aria-invalid={resolvedInvalid ? true : ariaInvalid}
      {...rest}
    />
  )
})
