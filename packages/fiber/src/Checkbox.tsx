import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { useFieldContext } from './fieldContext'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode
  description?: ReactNode
  /** Mark the control invalid without needing a surrounding Field. */
  invalid?: boolean
}

/** Native checkbox with an optional compact text treatment. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, id, invalid, required, label, description, 'aria-describedby': ariaDescribedBy, 'aria-invalid': ariaInvalid, ...rest },
  ref,
) {
  const field = useFieldContext()
  const generatedId = useId().replace(/:/g, '')
  const descriptionId = description ? `fiber-checkbox-${generatedId}-description` : undefined
  const resolvedInvalid = invalid ?? field?.invalid
  const describedBy = [field?.describedBy, descriptionId, ariaDescribedBy].filter(Boolean).join(' ') || undefined
  const control = (
    <input
      ref={ref}
      id={id ?? field?.controlId}
      type="checkbox"
      className={['checkbox-control', className].filter(Boolean).join(' ')}
      required={required ?? field?.required}
      aria-describedby={describedBy}
      aria-invalid={resolvedInvalid ? true : ariaInvalid}
      {...rest}
    />
  )

  if (!label && !description) return control

  return (
    <label className="checkbox">
      {control}
      <span className="checkbox-copy">
        {label ? <span className="checkbox-label">{label}</span> : null}
        {description ? <span className="checkbox-description" id={descriptionId}>{description}</span> : null}
      </span>
    </label>
  )
})
