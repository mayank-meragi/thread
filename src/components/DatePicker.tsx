import { useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { isoToday } from '../lib/dates'

interface DatePickerProps {
  selected: string
  onSelect: (date: string) => void
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`
}

function shiftMonth(monthIso: string, amount: number): string {
  const value = new Date(`${monthIso}T12:00:00`)
  value.setMonth(value.getMonth() + amount)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-01`
}

function buildGrid(monthIso: string): (string | null)[] {
  const first = new Date(`${monthIso}T12:00:00`)
  const year = first.getFullYear()
  const month = first.getMonth()
  const leadingBlanks = first.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = Array.from({ length: leadingBlanks }, () => null)
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }
  return cells
}

export function DatePicker({ selected, onSelect }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => monthStart(selected))
  const wrapRef = useRef<HTMLDivElement>(null)

  // Reset the visible month to the selection each time the popover opens.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setViewMonth(monthStart(selected))
  }

  useEffect(() => {
    if (!open) return
    const onOutside = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const today = isoToday()
  const cells = buildGrid(viewMonth)
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(`${viewMonth}T12:00:00`))

  return (
    <div className="date-picker" ref={wrapRef}>
      <button type="button" aria-label="Pick a date" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <CalendarDays size={16} />
      </button>
      {open && (
        <div className="menu-panel date-picker-panel" role="dialog" aria-label="Choose a date">
          <div className="date-picker-nav">
            <button type="button" aria-label="Previous month" onClick={() => setViewMonth((month) => shiftMonth(month, -1))}>
              <ChevronLeft size={14} />
            </button>
            <span>{monthLabel}</span>
            <button
              type="button"
              aria-label="Next month"
              disabled={viewMonth >= monthStart(today)}
              onClick={() => setViewMonth((month) => shiftMonth(month, 1))}
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="date-picker-weekdays">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, index) => <span key={index}>{label}</span>)}
          </div>
          <div className="date-picker-grid">
            {cells.map((date, index) => {
              if (!date) return <span key={index} />
              const disabled = date > today
              return (
                <button
                  key={date}
                  type="button"
                  disabled={disabled}
                  className={[
                    date === selected ? 'is-selected' : '',
                    date === today ? 'is-today' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => {
                    onSelect(date)
                    setOpen(false)
                  }}
                >
                  {Number(date.slice(8, 10))}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
