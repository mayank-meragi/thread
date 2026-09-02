import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'

function clamp(value: number, min: number, max: number | undefined): number {
  const low = Math.max(value, min)
  return max === undefined ? low : Math.min(low, max)
}

function round(value: number): number {
  // Keep step arithmetic from drifting into 59.99999999.
  return Math.round(value * 1000) / 1000
}

export function SetStepper({
  label,
  value,
  step,
  min = 0,
  max,
  integer = false,
  inputMode = 'decimal',
  onChange,
}: {
  label: string
  value: number | null
  step: number
  min?: number
  max?: number
  integer?: boolean
  inputMode?: 'decimal' | 'numeric'
  onChange: (next: number | null) => void
}) {
  // Local text buffer so a half-typed "1." or a transiently empty field is not
  // clobbered by the controlled value on every keystroke. Re-sync only when the
  // committed `value` prop actually changes (adjust-state-during-render).
  const [text, setText] = useState(value === null ? '' : String(value))
  const [syncedValue, setSyncedValue] = useState(value)
  if (value !== syncedValue) {
    setSyncedValue(value)
    setText(value === null ? '' : String(value))
  }

  const commitText = (raw: string) => {
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
    const next = round(clamp(integer ? Math.round(parsed) : parsed, min, max))
    onChange(next)
    setText(String(next))
  }

  const nudge = (direction: 1 | -1) => {
    const base = value ?? (direction === 1 ? min : min)
    const next = round(clamp(base + direction * step, min, max))
    onChange(next)
  }

  return (
    <div className="set-stepper">
      <span className="set-stepper-label">{label}</span>
      <div className="set-stepper-controls">
        <button
          type="button"
          className="set-stepper-btn"
          aria-label={`Decrease ${label}`}
          onClick={() => nudge(-1)}
        >
          <Minus size={16} aria-hidden="true" />
        </button>
        <input
          className="set-stepper-input"
          type="number"
          inputMode={inputMode}
          step={integer ? 1 : step}
          min={min}
          max={max}
          value={text}
          aria-label={label}
          onChange={(event) => setText(event.target.value)}
          onBlur={(event) => commitText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
        <button
          type="button"
          className="set-stepper-btn"
          aria-label={`Increase ${label}`}
          onClick={() => nudge(1)}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
