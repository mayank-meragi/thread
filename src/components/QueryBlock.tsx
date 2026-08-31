import { useEffect, useMemo, useRef, useState } from 'react'
import { Code2 } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type PropertyDefinitionRecord, type PropertyValue } from '../db'
import { loadSource, parseQuery, QueryParseError, runQuery, slugifyField, type Query, type RunResult } from '../lib/query'
import { PropertyControl } from './inspector/PropertyField'

interface ParseState {
  query?: Query
  error?: string
  position?: number
}

// Built-in row fields that are projections, not stored properties — never editable.
const READONLY_FIELDS = new Set(['title', 'name', 'id', 'origin', 'created', 'updated', 'color', 'property_count', 'usage'])

function formatCell(value: unknown): string {
  if (value == null || value === '') return '—'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

// Small stable hash so the show/hide preference can be remembered per query
// without stuffing the whole source string into a storage key.
function sourceKey(source: string): string {
  let hash = 0
  for (let i = 0; i < source.length; i += 1) hash = (Math.imul(31, hash) + source.charCodeAt(i)) | 0
  return `thread:qb-code-hidden:${hash}`
}

function readHidden(source: string): boolean {
  try {
    return localStorage.getItem(sourceKey(source)) === '1'
  } catch {
    return false
  }
}

export function QueryBlock({ source }: { source: string }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [codeHidden, setCodeHidden] = useState(() => readHidden(source))
  const [cellError, setCellError] = useState<string | null>(null)

  // The code editor is a sibling ProseMirror node right before this widget;
  // toggling a class on it is the least invasive way to collapse it.
  useEffect(() => {
    const codeEl = wrapRef.current?.parentElement?.previousElementSibling
    if (!(codeEl instanceof HTMLElement) || !codeEl.classList.contains('milkdown-code-block')) return
    codeEl.classList.toggle('qb-code-collapsed', codeHidden)
    return () => codeEl.classList.remove('qb-code-collapsed')
  }, [codeHidden])

  const toggleCode = () => {
    setCodeHidden((hidden) => {
      const next = !hidden
      try {
        if (next) localStorage.setItem(sourceKey(source), '1')
        else localStorage.removeItem(sourceKey(source))
      } catch {
        // best-effort persistence only
      }
      return next
    })
  }

  const parsed = useMemo<ParseState>(() => {
    const text = source.trim()
    if (!text) return { error: 'Empty query — try: LIST FROM threads' }
    try {
      return { query: parseQuery(text) }
    } catch (error) {
      if (error instanceof QueryParseError) return { error: error.message, position: error.position }
      return { error: (error as Error).message }
    }
  }, [source])

  const propertyDefs = useLiveQuery(() => db.propertyDefinitions.toArray(), [], [])
  const rows = useLiveQuery(
    () => (parsed.query ? loadSource(parsed.query.source) : Promise.resolve([])),
    [parsed.query?.source, parsed.query ? 1 : 0],
    [],
  )

  const result = useMemo<RunResult | { error: string } | null>(() => {
    if (!parsed.query) return null
    try {
      return runQuery(parsed.query, { rows, propertyDefs })
    } catch (error) {
      return { error: (error as Error).message }
    }
  }, [parsed.query, rows, propertyDefs])

  // A column is inline-editable when the query asked for it via EDITABLE, the
  // source is `threads`, and the name maps to a real (non-hidden) property.
  const editableDefFor = useMemo(() => {
    const wanted = result && !('error' in result) ? new Set(result.editable) : new Set<string>()
    return (fieldName: string): PropertyDefinitionRecord | null => {
      if (parsed.query?.source !== 'threads') return null
      const slug = slugifyField(fieldName)
      if (!wanted.has(slug) || READONLY_FIELDS.has(slug)) return null
      return propertyDefs.find((def) => !def.hidden && (def.id === fieldName || slugifyField(def.name) === slug)) ?? null
    }
  }, [result, parsed.query?.source, propertyDefs])

  const errorText = parsed.error
    ?? (result && 'error' in result
      ? result.error
      : null)

  const toggle = (
    <button type="button" className="query-block-toggle" onClick={toggleCode} aria-pressed={!codeHidden}>
      <Code2 size={13} />
      {codeHidden ? 'Show query' : 'Hide query'}
    </button>
  )

  if (errorText) {
    return (
      <div className="query-block-result is-error" ref={wrapRef}>
        <div className="query-block-meta">
          <span className="query-block-summary" role="alert">
            Query error{typeof parsed.position === 'number' ? ` · character ${parsed.position + 1}` : ''}
          </span>
          {toggle}
        </div>
        <div className="query-block-errorbody">{errorText}</div>
      </div>
    )
  }

  if (!result || 'error' in result) return null

  const isList = parsed.query?.select.kind === 'list'
  const count = result.rows.length

  const editControl = (threadId: string, def: PropertyDefinitionRecord, value: PropertyValue | undefined) => (
    <PropertyControl
      key={`${def.id}:${Array.isArray(value) ? value.join(',') : String(value ?? '')}`}
      target={{ kind: 'thread', threadId }}
      definition={def}
      value={value}
      onError={setCellError}
      compact
    />
  )

  return (
    <div className="query-block-result" ref={wrapRef}>
      <div className="query-block-meta">
        <span className={`query-block-summary${cellError ? ' is-error' : ''}`} role={cellError ? 'alert' : undefined}>
          {cellError ?? `${count} ${count === 1 ? 'result' : 'results'} · ${parsed.query?.source}`}
        </span>
        {toggle}
      </div>
      {count === 0 ? (
        <div className="query-block-empty">No matches.</div>
      ) : isList ? (
        <ul className="query-block-list">
          {result.rows.map((row) => (
            <li key={row.id}>
              <a href={row.link}>{formatCell(row.cells[0])}</a>
              {result.columns.slice(1).map((column, i) => {
                const cell = row.cells[i + 1]
                const def = editableDefFor(result.columnFields[i + 1])
                return (
                  <span className="query-block-chip" key={i}>
                    <span className="query-block-chip-label">{column}</span>
                    {def ? editControl(row.id, def, cell as PropertyValue | undefined) : formatCell(cell)}
                  </span>
                )
              })}
            </li>
          ))}
        </ul>
      ) : (
        <div className="query-block-table-wrap">
          <table className="query-block-table">
            <thead>
              <tr>{result.columns.map((column, index) => <th key={index}>{column}</th>)}</tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.id}>
                  {row.cells.map((cell, index) => {
                    const def = editableDefFor(result.columnFields[index])
                    return (
                      <td key={index} className={def ? 'is-editable' : undefined}>
                        {def
                          ? editControl(row.id, def, cell as PropertyValue | undefined)
                          : index === 0
                            ? <a href={row.link}>{formatCell(cell)}</a>
                            : formatCell(cell)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
