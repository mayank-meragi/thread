import { useRef, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'

export interface ToggleGroupOption {
  value: string
  label: ReactNode
  disabled?: boolean
}

export interface ToggleGroupProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  options: readonly ToggleGroupOption[]
  value?: string | readonly string[]
  defaultValue?: string | readonly string[]
  multiple?: boolean
  onValueChange?: (value: string | string[]) => void
  density?: 'compact' | 'default' | 'comfortable'
}

/** Keyboard-navigable single- or multi-select toggle choices. */
export function ToggleGroup({
  options,
  value,
  defaultValue,
  multiple = false,
  onValueChange,
  density,
  className,
  ...rest
}: ToggleGroupProps) {
  const firstEnabled = options.find((option) => !option.disabled)?.value ?? ''
  const initialValue = defaultValue ?? (multiple ? [] : firstEnabled)
  const [internalValue, setInternalValue] = useState<string | readonly string[]>(initialValue)
  const selected = value ?? internalValue
  const selectedValues = multiple ? new Set(Array.isArray(selected) ? selected : []) : new Set([selected as string])
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  const activate = (nextValue: string) => {
    const next = multiple
      ? Array.from(selectedValues).includes(nextValue)
        ? Array.from(selectedValues).filter((item) => item !== nextValue)
        : [...Array.from(selectedValues), nextValue]
      : nextValue
    if (value === undefined) setInternalValue(next)
    onValueChange?.(next)
  }

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      activate(options[index].value)
      return
    }

    const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    const enabledIndexes = options.map((option, optionIndex) => option.disabled ? -1 : optionIndex).filter((optionIndex) => optionIndex >= 0)
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const nextIndex = event.key === 'Home' ? enabledIndexes[0] : enabledIndexes[enabledIndexes.length - 1]
      if (nextIndex !== undefined) refs.current[nextIndex]?.focus()
      return
    }
    if (!direction || enabledIndexes.length < 2) return
    event.preventDefault()
    const currentPosition = Math.max(0, enabledIndexes.indexOf(index))
    const nextPosition = (currentPosition + direction + enabledIndexes.length) % enabledIndexes.length
    refs.current[enabledIndexes[nextPosition]]?.focus()
  }

  const selectedIndex = options.findIndex((option) => selectedValues.has(option.value))
  const tabIndexFor = (index: number) => {
    const fallbackIndex = options.findIndex((option) => !option.disabled)
    return index === (selectedIndex >= 0 ? selectedIndex : fallbackIndex) ? 0 : -1
  }

  return (
    <div
      className={['toggle-group', `toggle-group-${multiple ? 'multiple' : 'single'}`, className].filter(Boolean).join(' ')}
      {...rest}
      role={multiple ? 'group' : 'radiogroup'}
      aria-orientation="horizontal"
      data-density={density}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(element) => { refs.current[index] = element }}
          type="button"
          role={multiple ? 'checkbox' : 'radio'}
          aria-checked={selectedValues.has(option.value)}
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
