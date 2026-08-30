import { useMemo, useState } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type PropertyValue } from '../db'
import { NewPropertyForm, PropertyField } from './inspector/PropertyField'

// Thread-level counterpart to the Properties section in ContextualInspector.
// Values live in the thread note's `<!-- thread-metadata -->` envelope; edits
// route through setThreadProperty / removeThreadProperty.
export function ThreadProperties({ threadId }: { threadId: string }) {
  const definitions = useLiveQuery(() => db.propertyDefinitions.orderBy('name').toArray(), [], [])
  const rows = useLiveQuery(
    () => db.threadProperties.where('threadId').equals(threadId).toArray(),
    [threadId],
    [],
  )
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const values = useMemo(
    () => new Map<string, PropertyValue>(rows.map((row) => [row.propertyId, row.value])),
    [rows],
  )

  // Show every user-defined property plus any system property that already has
  // a value on this thread (matches how the block inspector filters).
  const ordered = definitions.filter((definition) => !definition.hidden && (!definition.system || values.has(definition.id)))

  return (
    <details className="projection-disclosure thread-properties">
      <summary>
        <span><ChevronRight size={15} /> Properties</span>
        <small>{values.size}</small>
      </summary>
      <div className="projection-disclosure-content">
        <div className="inspector-property-list">
          {ordered.map((definition) => (
            <PropertyField
              key={`${definition.id}:${JSON.stringify(values.get(definition.id))}`}
              target={{ kind: 'thread', threadId }}
              definition={definition}
              value={values.get(definition.id)}
              onError={setError}
            />
          ))}
          {ordered.length === 0 && <p className="field-hint">No properties defined yet.</p>}
        </div>
        {adding
          ? <NewPropertyForm onDone={() => setAdding(false)} onError={setError} />
          : <button type="button" className="inspector-add-property" onClick={() => setAdding(true)}><Plus size={14} /> New property</button>}
        {error && <p className="banner banner-error inspector-error" role="alert">{error}</p>}
      </div>
    </details>
  )
}
