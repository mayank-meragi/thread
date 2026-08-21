import { useEffect, useMemo, useState } from 'react'
import { Braces, CalendarDays, Check, Hash, Link2, Plus, Sparkles, Tag, Trash2, X } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  addBlockTag,
  createPropertyDefinition,
  createTag,
  db,
  removeBlockProperty,
  removeBlockTag,
  setBlockProperty,
  type PropertyDefinitionRecord,
  type PropertyType,
  type PropertyValue,
  type TagDefinitionRecord,
} from '../db'
import { kindLabel } from '../lib/blockMetadata'
import { formatDay } from '../lib/dates'

interface BlockInspectorProps {
  blockId: string | null
  onClose: () => void
}

const PROPERTY_TYPES: Array<{ value: PropertyType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'rich_text', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
  { value: 'url', label: 'URL' },
]

export function BlockInspector({ blockId, onClose }: BlockInspectorProps) {
  const block = useLiveQuery(async () => {
    if (!blockId) return undefined
    const direct = await db.blocks.get(blockId)
    if (direct) return direct
    // An editor mounted while the v6 migration was still reconciling can
    // briefly retain its former positional id. Resolve that one transitional
    // click through the persisted path map instead of presenting a dead end.
    const match = blockId.match(/^(\d{4}-\d{2}-\d{2}):(.+)$/)
    if (!match) return undefined
    const day = await db.days.get(match[1])
    const stableId = Object.entries(day?.metadata?.blocks ?? {}).find(([, item]) => item.path === match[2])?.[0]
    return stableId ? db.blocks.get(stableId) : undefined
  }, [blockId])
  const definitions = useLiveQuery(() => db.propertyDefinitions.orderBy('name').toArray(), [], [])
  const properties = useLiveQuery(
    () => block?.id ? db.blockProperties.where('blockId').equals(block.id).toArray() : [],
    [block?.id],
    [],
  )
  const tags = useLiveQuery(() => db.tagDefinitions.orderBy('name').toArray(), [], [])
  const appliedTags = useLiveQuery(
    () => block?.id ? db.blockTags.where('blockId').equals(block.id).toArray() : [],
    [block?.id],
    [],
  )
  const [newPropertyOpen, setNewPropertyOpen] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!blockId) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [blockId, onClose])

  const values = useMemo(() => new Map(properties.map((property) => [property.propertyId, property.value])), [properties])
  const applied = new Set(appliedTags.map((item) => item.tagId))
  const schemaByProperty = useMemo(() => {
    const result = new Map<string, { tag: typeof tags[number]; required: boolean }>()
    for (const tag of tags.filter((item) => appliedTags.some((appliedTag) => appliedTag.tagId === item.id))) {
      for (const propertyId of tag.propertyIds) {
        if (!result.has(propertyId)) result.set(propertyId, { tag, required: tag.requiredPropertyIds?.includes(propertyId) ?? false })
      }
    }
    return result
  }, [tags, appliedTags])
  const orderedDefinitions = useMemo(() => definitions.filter((definition) => !definition.hidden).sort((a, b) => {
    const schemaDifference = Number(schemaByProperty.has(b.id)) - Number(schemaByProperty.has(a.id))
    return schemaDifference || a.name.localeCompare(b.name)
  }), [definitions, schemaByProperty])

  if (!blockId) return null

  const run = async (operation: () => Promise<unknown>) => {
    setError(null)
    try { await operation() } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return (
    <div className="block-inspector-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <aside className="block-inspector" role="dialog" aria-modal="true" aria-labelledby="block-inspector-title">
        <header className="block-inspector-head">
          <div>
            <span className="block-inspector-kicker"><Braces size={13} /> Block properties</span>
            <h2 id="block-inspector-title">{block ? kindLabel(block.kind) : 'Block'}</h2>
          </div>
          <button type="button" className="inspector-icon-button" aria-label="Close properties" onClick={onClose}><X size={17} /></button>
        </header>

        {block ? <>
          <div className="block-inspector-source">
            <p>{block.plainText || 'Empty block'}</p>
            <span><CalendarDays size={13} /> {formatDay(block.day).full}</span>
            <a href={`#/?date=${block.day}&block=${block.id}`} onClick={onClose}><Link2 size={13} /> Open source</a>
          </div>

          <section className="inspector-section">
            <div className="inspector-section-title"><span><Tag size={14} /> Tags</span><small>{applied.size}</small></div>
            <div className="inspector-tags">
              {tags.map((tag) => {
                const application = appliedTags.find((item) => item.tagId === tag.id)
                return <button
                  type="button"
                  key={tag.id}
                  className={`${applied.has(tag.id) ? 'inspector-tag active' : 'inspector-tag'}${tag.propertyIds.length ? ' has-schema' : ''}${application?.source === 'inline' ? ' is-inline' : ''}`}
                  aria-pressed={applied.has(tag.id)}
                  title={application?.source === 'inline' ? 'Typed in this block' : tag.propertyIds.length ? 'Metadata schema' : undefined}
                  onClick={() => void run(() => applied.has(tag.id) ? removeBlockTag(block.id, tag.id) : addBlockTag(block.id, tag.id))}
                >
                  {tag.propertyIds.length > 0 ? <Sparkles size={11} /> : application?.source === 'inline' ? <Hash size={11} /> : applied.has(tag.id) ? <Check size={11} /> : null}#{tag.name}
                </button>
              })}
              <form className="inspector-inline-create" onSubmit={(event) => {
                event.preventDefault()
                const name = newTag.trim()
                if (!name) return
                void run(async () => {
                  const tag = await createTag(name)
                  await addBlockTag(block.id, tag.id)
                  setNewTag('')
                })
              }}>
                <Hash size={13} />
                <input value={newTag} onChange={(event) => setNewTag(event.target.value)} placeholder="New tag" aria-label="New tag name" />
                <button type="submit" aria-label="Create and add tag" disabled={!newTag.trim()}><Plus size={13} /></button>
              </form>
            </div>
          </section>

          <section className="inspector-section">
            <div className="inspector-section-title"><span><Braces size={14} /> Properties</span><small>{properties.length}</small></div>
            <div className="inspector-property-list">
              {orderedDefinitions.map((definition) => (
                <PropertyField
                  key={`${definition.id}:${JSON.stringify(values.get(definition.id))}`}
                  blockId={block.id}
                  definition={definition}
                  value={values.get(definition.id)}
                  schema={schemaByProperty.get(definition.id)}
                  onError={setError}
                />
              ))}
            </div>
            {newPropertyOpen
              ? <NewPropertyForm onDone={() => setNewPropertyOpen(false)} onError={setError} />
              : <button type="button" className="inspector-add-property" onClick={() => setNewPropertyOpen(true)}><Plus size={14} /> New property</button>}
          </section>

          {error && <p className="inspector-error" role="alert">{error}</p>}

          <footer className="block-inspector-foot">
            <span>Stable ID</span><code>{block.id}</code>
          </footer>
        </> : <div className="inspector-loading">Finding this block…</div>}
      </aside>
    </div>
  )
}

function PropertyField({
  blockId,
  definition,
  value,
  schema,
  onError,
}: {
  blockId: string
  definition: PropertyDefinitionRecord
  value: PropertyValue | undefined
  schema?: { tag: TagDefinitionRecord; required: boolean }
  onError: (message: string | null) => void
}) {
  const serialized = Array.isArray(value) ? value.join(', ') : value == null ? '' : String(value)
  const [draft, setDraft] = useState(serialized)

  const save = async (next: PropertyValue) => {
    onError(null)
    try {
      if (next === '' || next === null || (Array.isArray(next) && next.length === 0)) await removeBlockProperty(blockId, definition.id)
      else await setBlockProperty(blockId, definition.id, next)
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const control = (() => {
    if (definition.type === 'boolean') {
      return <button type="button" className={value === true ? 'property-boolean active' : 'property-boolean'} aria-pressed={value === true} onClick={() => void save(value !== true)}><span>{value === true && <Check size={12} />}</span>{value === true ? 'Yes' : 'No'}</button>
    }
    if ((definition.type === 'select' || definition.type === 'status') && definition.options?.length) {
      return <select value={typeof value === 'string' ? value : ''} onChange={(event) => void save(event.target.value)}>
        <option value="">Not set</option>
        {definition.options.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
      </select>
    }
    if (definition.type === 'rich_text') {
      return <textarea value={draft} rows={3} placeholder="Add context…" onChange={(event) => setDraft(event.target.value)} onBlur={() => void save(draft)} />
    }
    if (definition.type === 'multi_select' || definition.type === 'relation') {
      return <input value={draft} placeholder="Comma-separated values" onChange={(event) => setDraft(event.target.value)} onBlur={() => void save(draft.split(',').map((item) => item.trim()).filter(Boolean))} />
    }
    return <input
      type={definition.type === 'date' ? 'date' : definition.type === 'datetime' ? 'datetime-local' : definition.type === 'number' ? 'number' : definition.type === 'url' ? 'url' : 'text'}
      value={draft}
      placeholder="Not set"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void save(definition.type === 'number' && draft !== '' ? Number(draft) : draft)}
    />
  })()

  return (
    <div className="inspector-property">
      <label><span>{definition.name}{schema && <small className="property-schema-source">#{schema.tag.name}{schema.required ? ' · required' : ''}</small>}</span>{control}</label>
      {value !== undefined && <button type="button" className="property-remove" aria-label={`Remove ${definition.name}`} onClick={() => void save('')}><Trash2 size={13} /></button>}
    </div>
  )
}

function NewPropertyForm({ onDone, onError }: { onDone: () => void; onError: (message: string | null) => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<PropertyType>('text')
  return (
    <form className="new-property-form" onSubmit={(event) => {
      event.preventDefault()
      if (!name.trim()) return
      onError(null)
      void createPropertyDefinition({ name, type }).then(onDone).catch((caught) => onError(caught instanceof Error ? caught.message : String(caught)))
    }}>
      <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Property name" aria-label="Property name" />
      <select value={type} onChange={(event) => setType(event.target.value as PropertyType)} aria-label="Property type">
        {PROPERTY_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
      <button type="submit" className="primary-button" disabled={!name.trim()}>Create</button>
      <button type="button" className="text-button" onClick={onDone}>Cancel</button>
    </form>
  )
}
