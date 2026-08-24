import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { PersonaRecord } from '../../db'
import { DynamicIcon, iconFor } from '../../lib/icons'

export function PersonaSwitcher({
  personas,
  activePersonaId,
  onChange,
}: {
  personas: PersonaRecord[]
  activePersonaId: string
  onChange: (personaId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const active = personas.find((persona) => persona.id === activePersonaId)

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

  return (
    <div className="persona-switcher" ref={wrapRef}>
      <button
        type="button"
        className="persona-switcher-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <DynamicIcon name={active?.icon ?? 'Bot'} size={14} />
        <span>{active?.name ?? 'Persona'}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="persona-switcher-panel" role="listbox" aria-label="Personas">
          {personas.map((persona) => {
            const Icon = iconFor(persona.icon)
            const isActive = persona.id === activePersonaId
            return (
              <button
                key={persona.id}
                type="button"
                role="option"
                aria-selected={isActive}
                className={isActive ? 'persona-option active' : 'persona-option'}
                onClick={() => {
                  onChange(persona.id)
                  setOpen(false)
                }}
              >
                <Icon size={14} />
                <span>{persona.name}</span>
                {isActive && <Check size={13} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
