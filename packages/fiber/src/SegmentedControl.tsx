import { useRef, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'

export interface SegmentedControlOption {
  value: string
  label: ReactNode
  disabled?: boolean
}

export interface SegmentedControlProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  options: readonly SegmentedControlOption[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  density?: 'compact' | 'default' | 'comfortable'
}

/** Mutually exclusive compact choices with native radio-group semantics. */
export function SegmentedControl({
  options,
  value,
  defaultValue,
  onValueChange,
  density,
  className,
  ...rest
}: SegmentedControlProps) {
  const firstEnabled = options.find((option) => !option.disabled)?.value
  const [internalValue, setInternalValue] = useState(defaultValue ?? firstEnabled ?? '')
  const selectedValue = value ?? internalValue
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  const activate = (nextValue: string) => {
    if (value === undefined) setInternalValue(nextValue)
    onValueChange?.(nextValue)
  }

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    const enabledIndexes = options.map((option, optionIndex) => option.disabled ? -1 : optionIndex).filter((optionIndex) => optionIndex >= 0)
    if (event.key === 'Home') {
      event.preventDefault()
      const nextIndex = enabledIndexes[0]
      if (nextIndex !== undefined) {
        activate(options[nextIndex].value)
        refs.current[nextIndex]?.focus()
      }
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      const nextIndex = enabledIndexes[enabledIndexes.length - 1]
      if (nextIndex !== undefined) {
        activate(options[nextIndex].value)
        refs.current[nextIndex]?.focus()
      }
      return
    }
    if (!direction || enabledIndexes.length < 2) return
    event.preventDefault()
    const currentPosition = Math.max(0, enabledIndexes.indexOf(index))
    const nextPosition = (currentPosition + direction + enabledIndexes.length) % enabledIndexes.length
    const nextIndex = enabledIndexes[nextPosition]
    activate(options[nextIndex].value)
    refs.current[nextIndex]?.focus()
  }

  const selectedIndex = options.findIndex((option) => option.value === selectedValue)
  const tabIndexFor = (index: number) => index === (selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled)) ? 0 : -1

  return (
    <div
      className={['segmented-control', className].filter(Boolean).join(' ')}
      {...rest}
      role="radiogroup"
      aria-orientation="horizontal"
      data-density={density}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(element) => { refs.current[index] = element }}
          type="button"
          role="radio"
          aria-checked={selectedValue === option.value}
          tabIndex={tabIndexFor(index)}
          disabled={option.disabled}
          onClick={() => activate(option.value)}
          onKeyDown={(event) => move(event, index)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
