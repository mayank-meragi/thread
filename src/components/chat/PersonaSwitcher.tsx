import * as Icons from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { PersonaRecord } from '../../db'

function iconFor(name: string): LucideIcon {
  const icons = Icons as unknown as Record<string, LucideIcon>
  return icons[name] ?? Icons.Bot
}

export function PersonaSwitcher({
  personas,
  activePersonaId,
  onChange,
}: {
  personas: PersonaRecord[]
  activePersonaId: string
  onChange: (personaId: string) => void
}) {
  return (
    <div className="persona-switcher" role="tablist" aria-label="Personas">
      {personas.map((persona) => {
        const Icon = iconFor(persona.icon)
        const active = persona.id === activePersonaId
        return (
          <button
            key={persona.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? 'persona-chip active' : 'persona-chip'}
            title={persona.name}
            onClick={() => onChange(persona.id)}
          >
            <Icon size={14} />
            <span>{persona.name}</span>
          </button>
        )
      })}
    </div>
  )
}
