import { useState } from 'react'
import { Check, Trash2 } from 'lucide-react'
import {
  createPropertyDefinition,
  removeBlockProperty,
  setBlockProperty,
  setThreadProperty,
  type PropertyDefinitionRecord,
  type PropertyType,
  type PropertyValue,
  type TagDefinitionRecord,
} from '../../db'
import { PROPERTY_TYPES } from './propertyTypes'

// A property field edits either a block's property or a thread's property; the
// control and validation are identical, only the mutation differs.
export type PropertyTarget =
  | { kind: 'block'; blockId: string }
  | { kind: 'thread'; threadId: string }

function writeProperty(target: PropertyTarget, propertyId: string, next: PropertyValue): Promise<void> {
  const clear = next === '' || next === null || (Array.isArray(next) && next.length === 0)
  if (target.kind === 'thread') {
    // A property stays assigned to a thread until it is explicitly removed --
    // a blank value is stored as `null`, not a delete.
    return setThreadProperty(target.threadId, propertyId, clear ? null : next)
  }
  return clear ? removeBlockProperty(target.blockId, propertyId) : setBlockProperty(target.blockId, propertyId, next)
}

// Just the input control for one property value — no label, no remove button.
// Owns its own draft state and writes through `writeProperty`. Reused by the
// inspector's `PropertyField` and by editable query-block cells.
export function PropertyControl({
  target,
  definition,
  value,
  onError,
  compact = false,
}: {
  target: PropertyTarget
  definition: PropertyDefinitionRecord
  value: PropertyValue | undefined
  onError: (message: string | null) => void
  compact?: boolean
}) {
  const serialized = Array.isArray(value) ? value.join(', ') : value == null ? '' : String(value)
  const [draft, setDraft] = useState(serialized)

  const save = async (next: PropertyValue) => {
    onError(null)
    try {
      await writeProperty(target, definition.id, next)
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  if (definition.type === 'boolean') {
    return <button type="button" className={value === true ? 'property-boolean active' : 'property-boolean'} aria-pressed={value === true} onClick={() => void save(value !== true)}><span>{value === true && <Check size={12} />}</span>{value === true ? 'Yes' : 'No'}</button>
  }
  if ((definition.type === 'select' || definition.type === 'status') && definition.options?.length) {
    return <select value={typeof value === 'string' ? value : ''} onChange={(event) => void save(event.target.value)}>
      <option value="">Not set</option>
      {definition.options.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
    </select>
  }
  if (definition.type === 'rich_text' && !compact) {
    return <textarea value={draft} rows={3} placeholder="Add context…" onChange={(event) => setDraft(event.target.value)} onBlur={() => void save(draft)} />
  }
  if (definition.type === 'multi_select' || definition.type === 'relation') {
    return <input value={draft} placeholder="Comma-separated values" onChange={(event) => setDraft(event.target.value)} onBlur={() => void save(draft.split(',').map((item) => item.trim()).filter(Boolean))} />
  }
  return <input
    type={definition.type === 'date' ? 'date' : definition.type === 'datetime' ? 'datetime-local' : definition.type === 'number' ? 'number' : definition.type === 'url' ? 'url' : 'text'}
    value={draft}
    placeholder={compact ? '—' : 'Not set'}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={() => void save(definition.type === 'number' && draft !== '' ? Number(draft) : draft)}
  />
}

export function PropertyField({
  target,
  definition,
  value,
  schema,
  onError,
  onRemove,
}: {
  target: PropertyTarget
  definition: PropertyDefinitionRecord
  value: PropertyValue | undefined
  schema?: { tag: TagDefinitionRecord; required: boolean }
  onError: (message: string | null) => void
  // When set, the trash button un-assigns the property from its entity (used by
  // thread properties, where a blank value stays assigned). When omitted, the
  // trash button just clears the value and only shows once a value is present.
  onRemove?: () => void
}) {
  const clear = () => {
    onError(null)
    if (onRemove) { onRemove(); return }
    void writeProperty(target, definition.id, '').catch((caught) => onError(caught instanceof Error ? caught.message : String(caught)))
  }

  return (
    <div className="inspector-property">
      <label>
        <span>{definition.name}{schema && <small className="property-schema-source">#{schema.tag.name}{schema.required ? ' · required' : ''}</small>}</span>
        <PropertyControl target={target} definition={definition} value={value} onError={onError} />
      </label>
      {(onRemove || value !== undefined) && <button type="button" className="tap-target-sm property-remove" aria-label={`Remove ${definition.name}`} onClick={clear}><Trash2 size={13} /></button>}
    </div>
  )
}

export function NewPropertyForm({ onDone, onError }: { onDone: (created?: PropertyDefinitionRecord) => void; onError: (message: string | null) => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<PropertyType>('text')
  return (
    <form className="new-property-form" onSubmit={(event) => {
      event.preventDefault()
      if (!name.trim()) return
      onError(null)
      void createPropertyDefinition({ name, type }).then((created) => onDone(created)).catch((caught) => onError(caught instanceof Error ? caught.message : String(caught)))
    }}>
      <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Property name" aria-label="Property name" />
      <select value={type} onChange={(event) => setType(event.target.value as PropertyType)} aria-label="Property type">
        {PROPERTY_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
      <button type="submit" className="primary-button" disabled={!name.trim()}>Create</button>
      <button type="button" className="text-button" onClick={() => onDone()}>Cancel</button>
    </form>
  )
}
