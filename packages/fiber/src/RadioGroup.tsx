import { useId, useState, type FieldsetHTMLAttributes, type ReactNode } from 'react'

export interface RadioOption {
  value: string
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}

export interface RadioGroupProps extends Omit<FieldsetHTMLAttributes<HTMLFieldSetElement>, 'onChange' | 'value' | 'defaultValue' | 'disabled' | 'children'> {
  options: RadioOption[]
  name?: string
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  disabled?: boolean
  orientation?: 'vertical' | 'horizontal'
}

/** Native radio group; browser arrow-key behavior remains intact. */
export function RadioGroup({
  options,
  name,
  value,
  defaultValue,
  onValueChange,
  label,
  hint,
  error,
  disabled = false,
  orientation = 'vertical',
  className,
  ...rest
}: RadioGroupProps) {
  const generatedId = useId().replace(/:/g, '')
  const groupName = name ?? `fiber-radio-${generatedId}`
  const hintId = hint && !error ? `fiber-radio-${generatedId}-hint` : undefined
  const errorId = error ? `fiber-radio-${generatedId}-error` : undefined
  const [internalValue, setInternalValue] = useState(defaultValue ?? '')
  const selectedValue = value ?? internalValue

  function select(nextValue: string) {
    if (value === undefined) setInternalValue(nextValue)
    onValueChange?.(nextValue)
  }

  return (
    <fieldset
      className={['radio-group', `radio-group-${orientation}`, error ? 'radio-group-error' : '', className].filter(Boolean).join(' ')}
      aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
      aria-invalid={error ? true : undefined}
      {...rest}
    >
      {label ? <legend className="radio-group-label">{label}</legend> : null}
      <div className="radio-group-options">
        {options.map((option) => {
          const optionId = `fiber-radio-${generatedId}-${option.value.replace(/[^a-zA-Z0-9_-]/g, '-')}`
          return (
            <label className="radio-option" key={option.value} htmlFor={optionId}>
              <input
                id={optionId}
                type="radio"
                name={groupName}
                value={option.value}
                checked={selectedValue === option.value}
                disabled={disabled || option.disabled}
                onChange={() => select(option.value)}
              />
              <span className="radio-option-copy">
                <span className="radio-option-label">{option.label}</span>
                {option.description ? <span className="radio-option-description">{option.description}</span> : null}
              </span>
            </label>
          )
        })}
      </div>
      {hintId ? <p className="field-hint" id={hintId}>{hint}</p> : null}
      {errorId ? <p className="field-hint field-hint-error" id={errorId} role="alert">{error}</p> : null}
    </fieldset>
  )
}
