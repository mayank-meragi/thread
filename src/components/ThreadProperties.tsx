import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, removeThreadProperty, setThreadIsTemplate, setThreadProperty, type PropertyValue } from '../db'
import { AddPropertyControl } from './inspector/AddPropertyControl'
import { PropertyField } from './inspector/PropertyField'

// Thread-level counterpart to the Properties section in ContextualInspector.
// Unlike the block inspector, a thread only shows the properties assigned to
// *it* -- a property is assigned by adding it here (persisted as a `null`
// entry in the thread note's `<!-- thread-metadata -->` envelope) and stays
// until removed, blank value or not.
export function ThreadProperties({ threadId, isTemplate }: { threadId: string; isTemplate: boolean }) {
  const definitions = useLiveQuery(() => db.propertyDefinitions.orderBy('name').toArray(), [], [])
  const rows = useLiveQuery(
    () => db.threadProperties.where('threadId').equals(threadId).toArray(),
    [threadId],
    [],
  )
  const [error, setError] = useState<string | null>(null)

  const values = useMemo(
    () => new Map<string, PropertyValue>(rows.map((row) => [row.propertyId, row.value])),
    [rows],
  )

  const shown = definitions.filter((definition) => values.has(definition.id))
  const available = definitions.filter((definition) => !definition.hidden && !values.has(definition.id))

  const assign = (propertyId: string) => {
    setError(null)
    void setThreadProperty(threadId, propertyId, null).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))
  }

  return (
    <details className="projection-disclosure thread-properties">
      <summary>
        <span><ChevronRight size={15} /> Properties</span>
        <small>{shown.length}</small>
      </summary>
      <div className="projection-disclosure-content">
        <div className="inspector-property-list">
          {shown.map((definition) => (
            <PropertyField
              key={`${definition.id}:${JSON.stringify(values.get(definition.id))}`}
              target={{ kind: 'thread', threadId }}
              definition={definition}
              value={values.get(definition.id) ?? undefined}
              onError={setError}
              onRemove={() => void removeThreadProperty(threadId, definition.id)}
            />
          ))}
          {shown.length === 0 && <p className="field-hint">No properties on this thread yet.</p>}
        </div>

        <AddPropertyControl
          available={available}
          definitions={definitions}
          onAssign={assign}
          onError={setError}
        />

        {error && <p className="banner banner-error inspector-error" role="alert">{error}</p>}

        <div className="thread-properties-template">
          <span>Template</span>
          <button
            type="button"
            className={isTemplate ? 'property-boolean active' : 'property-boolean'}
            aria-pressed={isTemplate}
            onClick={() => void setThreadIsTemplate(threadId, !isTemplate)}
          >
            {isTemplate ? 'Yes' : 'No'}
          </button>
        </div>
      </div>
    </details>
  )
}
