import { Button, MenuItem, Popover } from 'fiber'
import { useState } from 'react'
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
  const active = personas.find((persona) => persona.id === activePersonaId)

  return (
    <div className="persona-switcher">
      <Popover
        open={open}
        onOpenChange={setOpen}
        modal
        contentRole="listbox"
        className="menu-panel persona-switcher-panel"
        aria-label="Personas"
        trigger={
          <Button unstyled
            type="button"
            className="persona-switcher-trigger"
            aria-haspopup="listbox"
          >
            <DynamicIcon name={active?.icon ?? 'Bot'} size={14} />
            <span>{active?.name ?? 'Persona'}</span>
            <ChevronDown size={13} />
          </Button>
        }
      >
          {personas.map((persona) => {
            const Icon = iconFor(persona.icon)
            const isActive = persona.id === activePersonaId
            return (
              <MenuItem
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
              </MenuItem>
            )
          })}
      </Popover>
    </div>
  )
}
