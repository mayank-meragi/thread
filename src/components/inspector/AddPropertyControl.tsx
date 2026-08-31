import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { createPropertyDefinition, type PropertyDefinitionRecord, type PropertyType } from '../../db'
import { PROPERTY_TYPES } from './propertyTypes'

const MAX_ROWS = 8

// One "pick or create" control that replaces the old select + New-property
// form: type a name, choose a matching existing property, or create a new one
// when nothing matches (the query row carries its own type picker, since a
// definition's type can never be changed later).
export function AddPropertyControl({
  available,
  definitions,
  onAssign,
  onError,
}: {
  available: PropertyDefinitionRecord[]
  definitions: PropertyDefinitionRecord[]
  onAssign: (propertyId: string) => void
  onError: (message: string | null) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<PropertyType>('text')
  const [highlighted, setHighlighted] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const trimmed = query.trim()
  const normalized = trimmed.toLocaleLowerCase()

  const matches = useMemo(() => {
    const list = normalized
      ? available.filter((definition) => definition.name.toLocaleLowerCase().includes(normalized))
      : available
    return list.slice(0, MAX_ROWS)
  }, [available, normalized])

  const exact = normalized
    ? definitions.find((definition) => definition.name.toLocaleLowerCase() === normalized)
    : undefined
  const exactAssigned = Boolean(exact) && !available.some((definition) => definition.id === exact!.id)
  const showCreate = Boolean(trimmed) && !exact

  // The Create row, when present, is the last selectable entry.
  const rowCount = matches.length + (showCreate ? 1 : 0)

  // Keep the highlight in range as the result set changes (adjust during
  // render, mirroring Omnibox).
  const [seenKey, setSeenKey] = useState('')
  const key = `${open}:${normalized}:${rowCount}`
  if (key !== seenKey) {
    setSeenKey(key)
    setHighlighted(0)
  }

  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  const reset = () => {
    setQuery('')
    setType('text')
    setOpen(false)
  }

  const assignExisting = (propertyId: string) => {
    onError(null)
    onAssign(propertyId)
    reset()
    inputRef.current?.focus()
  }

  const create = () => {
    if (!trimmed) return
    onError(null)
    void createPropertyDefinition({ name: trimmed, type })
      .then((definition) => { onAssign(definition.id) })
      .catch((caught) => onError(caught instanceof Error ? caught.message : String(caught)))
    reset()
    inputRef.current?.focus()
  }

  const activate = (index: number) => {
    if (index < matches.length) assignExisting(matches[index].id)
    else if (showCreate) create()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); reset(); return }
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setHighlighted((i) => Math.min(i + 1, rowCount - 1)); return }
    if (event.key === 'ArrowUp') { event.preventDefault(); setHighlighted((i) => Math.max(i - 1, 0)); return }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (rowCount > 0) activate(highlighted)
    }
  }

  return (
    <div className="add-property" ref={wrapRef}>
      <input
        ref={inputRef}
        className="add-property-input"
        value={query}
        placeholder="Add property…"
        aria-label="Add a property to this thread"
        onFocus={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
        onKeyDown={onKeyDown}
      />
      {open && (matches.length > 0 || showCreate || exactAssigned) && (
        <div className="menu-panel add-property-menu" role="listbox">
          {matches.map((definition, index) => (
            <button
              key={definition.id}
              type="button"
              role="option"
              aria-selected={index === highlighted}
              className={index === highlighted ? 'menu-item active' : 'menu-item'}
              onMouseEnter={() => setHighlighted(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => assignExisting(definition.id)}
            >
              <span>{definition.name}</span>
              <small className="add-property-type">{definition.type.replace('_', ' ')}</small>
            </button>
          ))}
          {showCreate && (
            <div
              className={`menu-item add-property-create${highlighted === matches.length ? ' active' : ''}`}
              onMouseEnter={() => setHighlighted(matches.length)}
            >
              <button
                type="button"
                className="add-property-create-main"
                onMouseDown={(event) => event.preventDefault()}
                onClick={create}
              >
                <Plus size={14} /> Create “{trimmed}”
              </button>
              <select
                aria-label="New property type"
                value={type}
                onMouseDown={(event) => event.stopPropagation()}
                onChange={(event) => setType(event.target.value as PropertyType)}
              >
                {PROPERTY_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </div>
          )}
          {!showCreate && matches.length === 0 && exactAssigned && (
            <p className="add-property-hint">“{exact!.name}” is already on this thread.</p>
          )}
        </div>
      )}
    </div>
  )
}
