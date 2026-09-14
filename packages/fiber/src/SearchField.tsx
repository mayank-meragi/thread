import { Search, X } from 'lucide-react'
import { forwardRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { IconButton } from './IconButton'
import { Input, type InputProps } from './Input'
import { useFieldContext } from './fieldContext'

export interface SearchFieldProps extends Omit<InputProps, 'type'> {
  shortcut?: ReactNode
  clearable?: boolean
  onClear?: () => void
}

/** Input recipe for filtering dense lists without adding another visual shell. */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { className, shortcut, clearable = false, onClear, value, defaultValue, onChange, 'aria-label': ariaLabel, placeholder = 'Search', ...rest },
  ref,
) {
  const field = useFieldContext()
  const [internalValue, setInternalValue] = useState(() => String(defaultValue ?? ''))
  const resolvedValue = value === undefined ? internalValue : String(value)
  const hasValue = resolvedValue.length > 0
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    if (value === undefined) setInternalValue(event.target.value)
    onChange?.(event)
  }
  function clear() {
    if (value === undefined) setInternalValue('')
    onClear?.()
  }
  const resolvedAriaLabel = ariaLabel ?? (field ? undefined : 'Search')

  return (
    <span className={['search-field', className].filter(Boolean).join(' ')}>
      <Search className="search-field-icon" size={15} aria-hidden="true" />
      <Input ref={ref} type="search" value={resolvedValue} onChange={handleChange} placeholder={placeholder} aria-label={resolvedAriaLabel} {...rest} className="search-field-control" />
      {clearable && hasValue ? <IconButton className="search-field-clear" variant="ghost" size="sm" aria-label="Clear search" onClick={clear}><X size={14} /></IconButton> : null}
      {shortcut && !hasValue ? <kbd className="search-field-shortcut">{shortcut}</kbd> : null}
    </span>
  )
})
