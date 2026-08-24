import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { DynamicIcon, iconFor, PERSONA_ICON_NAMES } from '../lib/icons'

export function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

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

  // Reset the search each time the popover opens, mirroring DatePicker's
  // reset-on-open pattern -- adjusted during render rather than in an effect
  // so clearing it doesn't cost an extra render.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) setQuery('')
  }

  const filtered = PERSONA_ICON_NAMES.filter((name) => name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))

  return (
    <div className="icon-picker" ref={wrapRef}>
      <button type="button" className="icon-picker-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <DynamicIcon name={value} size={16} />
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="icon-picker-panel" role="dialog" aria-label="Choose an icon">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search icons…"
          />
          <div className="icon-picker-grid">
            {filtered.map((name) => {
              const ItemIcon = iconFor(name)
              return (
                <button
                  key={name}
                  type="button"
                  className={name === value ? 'is-selected' : ''}
                  title={name}
                  onClick={() => {
                    onChange(name)
                    setOpen(false)
                  }}
                >
                  <ItemIcon size={16} />
                </button>
              )
            })}
            {filtered.length === 0 && <p className="icon-picker-empty">No icons match.</p>}
          </div>
        </div>
      )}
    </div>
  )
}
