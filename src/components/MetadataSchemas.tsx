import { useState } from 'react'
import { Braces, Check, ChevronDown, Hash, Plus, Save, Sparkles, Trash2 } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  createPropertyDefinition,
  createTag,
  db,
  deleteTagDefinition,
  updateTagDefinition,
  type PropertyDefinitionRecord,
  type PropertyType,
  type PropertyValue,
  type TagDefinitionRecord,
} from '../db'
import { DEFAULT_TAG_COLOR } from '../lib/tagColors'

const FIELD_TYPES: Array<{ value: PropertyType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'rich_text', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
  { value: 'url', label: 'URL' },
]

export function MetadataSchemas() {
  const tags = useLiveQuery(() => db.tagDefinitions.orderBy('name').toArray(), [], [])
  const definitions = useLiveQuery(() => db.propertyDefinitions.orderBy('name').toArray(), [], [])
  const [newSchema, setNewSchema] = useState('')
  const [newField, setNewField] = useState('')
  const [newFieldType, setNewFieldType] = useState<PropertyType>('text')
  const [error, setError] = useState('')

  const run = async (operation: () => Promise<unknown>) => {
    setError('')
    try { await operation() } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
  }

  return (
    <section className="settings-card schema-settings-card">
      <div className="settings-title">
        <Sparkles size={20} />
        <div><h2>Metadata schemas</h2><p>Turn a tag into a reusable set of fields. Applying it to any block adds the schema and its defaults.</p></div>
      </div>

      <form className="schema-create" onSubmit={(event) => {
        event.preventDefault()
        const name = newSchema.trim()
        if (!name) return
        void run(async () => { await createTag(name); setNewSchema('') })
      }}>
        <Hash size={15} />
        <input value={newSchema} onChange={(event) => setNewSchema(event.target.value)} placeholder="New schema tag" aria-label="New schema tag" />
        <button type="submit" className="secondary-button" disabled={!newSchema.trim()}><Plus size={14} /> Create schema</button>
      </form>

      <div className="schema-ledger">
        {tags?.map((tag) => <SchemaEditor key={`${tag.id}:${tag.updatedAt}`} tag={tag} definitions={definitions ?? []} onError={setError} />)}
        {tags?.length === 0 && <div className="schema-empty"><Braces size={18} /><span>No schemas yet. Create one for projects, people, meetings, or anything you repeat.</span></div>}
      </div>

      <div className="schema-field-library">
        <div><span>Field library</span><small>{definitions?.filter((item) => !item.hidden).length ?? 0} available</small></div>
        <form onSubmit={(event) => {
          event.preventDefault()
          const name = newField.trim()
          if (!name) return
          void run(async () => { await createPropertyDefinition({ name, type: newFieldType }); setNewField('') })
        }}>
          <input value={newField} onChange={(event) => setNewField(event.target.value)} placeholder="New field name" aria-label="New field name" />
          <select value={newFieldType} onChange={(event) => setNewFieldType(event.target.value as PropertyType)} aria-label="New field type">
            {FIELD_TYPES.map((type) => <option value={type.value} key={type.value}>{type.label}</option>)}
          </select>
          <button type="submit" className="text-button" disabled={!newField.trim()}><Plus size={14} /> Add field</button>
        </form>
      </div>
      {error && <p className="banner banner-error form-error" role="alert">{error}</p>}
    </section>
  )
}

function SchemaEditor({ tag, definitions, onError }: { tag: TagDefinitionRecord; definitions: PropertyDefinitionRecord[]; onError: (message: string) => void }) {
  const visibleDefinitions = definitions.filter((definition) => !definition.hidden)
  const [name, setName] = useState(tag.name)
  const [color, setColor] = useState(tag.color ?? DEFAULT_TAG_COLOR)
  const [propertyIds, setPropertyIds] = useState<string[]>(tag.propertyIds)
  const [required, setRequired] = useState<string[]>(tag.requiredPropertyIds ?? [])
  const [defaults, setDefaults] = useState<Record<string, PropertyValue>>(tag.propertyDefaults ?? {})
  const [saved, setSaved] = useState(false)

  const toggleField = (propertyId: string) => {
    if (propertyIds.includes(propertyId)) {
      setPropertyIds((items) => items.filter((item) => item !== propertyId))
      setRequired((items) => items.filter((item) => item !== propertyId))
      setDefaults((items) => { const next = { ...items }; delete next[propertyId]; return next })
    } else setPropertyIds((items) => [...items, propertyId])
  }

  const save = async () => {
    setSaved(false)
    try {
      await updateTagDefinition(tag.id, { name, color, propertyIds, requiredPropertyIds: required, propertyDefaults: defaults })
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1400)
    } catch (caught) { onError(caught instanceof Error ? caught.message : String(caught)) }
  }

  return (
    <details className="schema-editor">
      <summary>
        <span className="schema-color" style={{ background: tag.color ?? DEFAULT_TAG_COLOR }} />
        <span><b>#{tag.name}</b><small>{tag.propertyIds.length ? `${tag.propertyIds.length} field${tag.propertyIds.length === 1 ? '' : 's'}` : 'Plain tag'}</small></span>
        <ChevronDown size={15} />
      </summary>
      <div className="schema-editor-body">
        <div className="schema-name-row">
          <input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label={`${tag.name} color`} />
          <label><span>Schema name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
        </div>
        <div className="schema-column-head"><span>Field</span><span>Required</span><span>Default</span></div>
        <div className="schema-fields">
          {visibleDefinitions.map((definition) => {
            const active = propertyIds.includes(definition.id)
            return (
              <div className={active ? 'schema-field active' : 'schema-field'} key={definition.id}>
                <label className="schema-field-toggle">
                  <input type="checkbox" checked={active} onChange={() => toggleField(definition.id)} />
                  <span>{active && <Check size={11} />}</span>
                  <b>{definition.name}</b><small>{definition.type.replace('_', ' ')}</small>
                </label>
                <label className="schema-required"><input type="checkbox" checked={required.includes(definition.id)} disabled={!active} onChange={(event) => setRequired((items) => event.target.checked ? [...items, definition.id] : items.filter((item) => item !== definition.id))} /><span>Required</span></label>
                <DefaultField definition={definition} disabled={!active} value={defaults[definition.id]} onChange={(value) => setDefaults((items) => {
                  const next = { ...items }
                  if (value === undefined) delete next[definition.id]
                  else next[definition.id] = value
                  return next
                })} />
              </div>
            )
          })}
        </div>
        <div className="schema-editor-actions">
          <button type="button" className="primary-button" onClick={() => void save()}><Save size={14} /> {saved ? 'Saved' : 'Save schema'}</button>
          <button type="button" className="text-button schema-delete" onClick={() => {
            if (!window.confirm(`Delete #${tag.name}? The tag will be removed from every block. Explicit property values will stay.`)) return
            void deleteTagDefinition(tag.id).catch((caught) => onError(caught instanceof Error ? caught.message : String(caught)))
          }}><Trash2 size={14} /> Delete</button>
        </div>
      </div>
    </details>
  )
}

function DefaultField({ definition, disabled, value, onChange }: { definition: PropertyDefinitionRecord; disabled: boolean; value: PropertyValue | undefined; onChange: (value: PropertyValue | undefined) => void }) {
  if (definition.type === 'boolean') {
    return <select aria-label={`${definition.name} default`} disabled={disabled} value={value === true ? 'true' : value === false ? 'false' : ''} onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value === 'true')}><option value="">No default</option><option value="true">Yes</option><option value="false">No</option></select>
  }
  if ((definition.type === 'select' || definition.type === 'status') && definition.options?.length) {
    return <select aria-label={`${definition.name} default`} disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value || undefined)}><option value="">No default</option>{definition.options.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select>
  }
  return <input
    aria-label={`${definition.name} default`}
    disabled={disabled}
    type={definition.type === 'date' ? 'date' : definition.type === 'number' ? 'number' : definition.type === 'url' ? 'url' : 'text'}
    value={typeof value === 'string' || typeof value === 'number' ? value : ''}
    placeholder="No default"
    onChange={(event) => onChange(event.target.value === '' ? undefined : definition.type === 'number' ? Number(event.target.value) : event.target.value)}
  />
}
