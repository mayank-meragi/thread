import { forwardRef, type SelectHTMLAttributes } from 'react'
import { useFieldContext } from './fieldContext'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Mark the control invalid without needing a surrounding Field. */
  invalid?: boolean
}

/** Native select primitive with the shared Field accessibility contract. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, id, invalid, required, 'aria-describedby': ariaDescribedBy, 'aria-invalid': ariaInvalid, children, ...rest },
  ref,
) {
  const field = useFieldContext()
  const resolvedInvalid = invalid ?? field?.invalid
  const describedBy = [field?.describedBy, ariaDescribedBy].filter(Boolean).join(' ') || undefined

  return (
    <span className="field-select-wrap">
      <select
        ref={ref}
        id={id ?? field?.controlId}
        className={['field-control', 'field-select', className].filter(Boolean).join(' ')}
        required={required ?? field?.required}
        aria-describedby={describedBy}
        aria-invalid={resolvedInvalid ? true : ariaInvalid}
        {...rest}
      >
        {children}
      </select>
    </span>
  )
})
