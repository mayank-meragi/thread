import { useState } from 'react'

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * A plain labelled number input for the secondary set metrics (duration,
 * distance) shown under "More details". Mirrors SetStepper's local text buffer
 * so a half-typed or transiently empty value survives re-renders, but without
 * the +/- controls.
 */
export function NumberField({
  label,
  value,
  placeholder,
  min = 0,
  integer = false,
  inputMode = 'decimal',
  onChange,
}: {
  label: string
  value: number | null
  placeholder?: string
  min?: number
  integer?: boolean
  inputMode?: 'decimal' | 'numeric'
  onChange: (next: number | null) => void
}) {
  const [text, setText] = useState(value === null ? '' : String(value))
  const [syncedValue, setSyncedValue] = useState(value)
  if (value !== syncedValue) {
    setSyncedValue(value)
    setText(value === null ? '' : String(value))
  }

  const commit = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) {
      onChange(null)
      return
    }
    const parsed = Number(trimmed)
    if (Number.isNaN(parsed)) {
      setText(value === null ? '' : String(value))
      return
    }
    const next = round(Math.max(integer ? Math.round(parsed) : parsed, min))
    onChange(next)
    setText(String(next))
  }

  return (
    <label className="number-field">
      <span className="number-field-label">{label}</span>
      <input
        className="number-field-input"
        type="number"
        inputMode={inputMode}
        min={min}
        value={text}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => setText(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </label>
  )
}
