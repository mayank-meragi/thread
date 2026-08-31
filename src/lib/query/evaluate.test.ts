import { describe, expect, it } from 'vitest'
import type { PropertyDefinitionRecord } from '../blockMetadata'
import { runQuery } from './evaluate'
import { parseQuery } from './grammar'
import type { Row } from './types'

function def(id: string, type: PropertyDefinitionRecord['type'], name = id): PropertyDefinitionRecord {
  return { id, name, type, createdAt: '', updatedAt: '' }
}

const propertyDefs: PropertyDefinitionRecord[] = [
  def('status', 'status', 'Status'),
  def('priority', 'select', 'Priority'),
  def('estimate-minutes', 'number', 'Estimate'),
  def('due-date', 'date', 'Due date'),
  def('labels', 'multi_select', 'Labels'),
  def('archived', 'boolean', 'Archived'),
]

function row(id: string, fields: Record<string, unknown>): Row {
  return {
    id,
    link: `#/thread/${id}`,
    fields: new Map<string, unknown>([['id', id], ...Object.entries(fields)]) as Row['fields'],
  }
}

const rows: Row[] = [
  row('alpha', { title: 'Alpha', status: 'active', priority: 'high', 'estimate-minutes': 90, 'due-date': '2026-09-01', labels: ['ui', 'infra'], updated: '2026-08-20' }),
  row('beta', { title: 'Beta draft', status: 'active', priority: 'low', 'estimate-minutes': 15, 'due-date': '2026-07-01', labels: ['ui'], updated: '2026-08-28' }),
  row('gamma', { title: 'Gamma', status: 'done', priority: 'high', 'estimate-minutes': 60, archived: true, updated: '2026-08-10' }),
]

function ids(source: string): string[] {
  return runQuery(parseQuery(source), { rows, propertyDefs }).rows.map((entry) => entry.id)
}

describe('runQuery — filtering', () => {
  it('matches string equality case-insensitively', () => {
    expect(ids('LIST FROM threads WHERE status = ACTIVE')).toEqual(['alpha', 'beta'])
  })

  it('applies implicit AND', () => {
    expect(ids('LIST FROM threads WHERE status = active priority = high')).toEqual(['alpha'])
  })

  it('compares numbers ordinally', () => {
    expect(ids('LIST FROM threads WHERE estimate-minutes > 30')).toEqual(['alpha', 'gamma'])
    expect(ids('LIST FROM threads WHERE estimate-minutes <= 15')).toEqual(['beta'])
  })

  it('compares dates', () => {
    expect(ids('LIST FROM threads WHERE due-date < 2026-08-01')).toEqual(['beta'])
  })

  it('supports CONTAINS on text and on array fields', () => {
    expect(ids('LIST FROM threads WHERE title CONTAINS draft')).toEqual(['beta'])
    expect(ids('LIST FROM threads WHERE labels CONTAINS infra')).toEqual(['alpha'])
  })

  it('treats = on an array field as membership', () => {
    expect(ids('LIST FROM threads WHERE labels = ui')).toEqual(['alpha', 'beta'])
  })

  it('evaluates NOT and OR', () => {
    expect(ids('LIST FROM threads WHERE NOT status = active')).toEqual(['gamma'])
    expect(ids('LIST FROM threads WHERE priority = low OR status = done')).toEqual(['beta', 'gamma'])
  })

  it('evaluates a bare field as truthiness', () => {
    expect(ids('LIST FROM threads WHERE archived')).toEqual(['gamma'])
  })

  it('matches null against a missing field', () => {
    expect(ids('LIST FROM threads WHERE due-date = null')).toEqual(['gamma'])
  })
})

describe('runQuery — shaping', () => {
  it('sorts ascending and descending with a stable tiebreak', () => {
    expect(ids('LIST FROM threads SORT estimate-minutes ASC')).toEqual(['beta', 'gamma', 'alpha'])
    expect(ids('LIST FROM threads SORT updated DESC')).toEqual(['beta', 'alpha', 'gamma'])
  })

  it('limits the result set', () => {
    expect(ids('LIST FROM threads SORT estimate-minutes DESC LIMIT 2')).toEqual(['alpha', 'gamma'])
  })

  it('defaults a LIST to the title column', () => {
    const result = runQuery(parseQuery('LIST FROM threads WHERE id = alpha'), { rows, propertyDefs })
    expect(result.columns).toEqual(['title'])
    expect(result.rows[0].cells).toEqual(['Alpha'])
  })

  it('projects TABLE columns in order, filling missing cells with null', () => {
    const result = runQuery(parseQuery('TABLE priority, archived FROM threads WHERE id = beta'), { rows, propertyDefs })
    expect(result.columns).toEqual(['priority', 'archived'])
    expect(result.rows[0].cells).toEqual(['low', null])
  })

  it('resolves a field by its definition name slug', () => {
    // "Due date" -> due-date
    expect(ids('LIST FROM threads WHERE "Due date" < 2026-08-01')).toEqual(['beta'])
  })

  it('prepends the title to a LIST that carries extra fields', () => {
    const result = runQuery(parseQuery('LIST priority, status FROM threads WHERE id = alpha'), { rows, propertyDefs })
    expect(result.columns).toEqual(['title', 'priority', 'status'])
    expect(result.rows[0].cells).toEqual(['Alpha', 'high', 'active'])
  })

  it('reports EDITABLE fields as slugs', () => {
    const result = runQuery(parseQuery('TABLE title, "Due date" FROM threads EDITABLE "Due date", Priority'), { rows, propertyDefs })
    expect(result.editable).toEqual(['due-date', 'priority'])
  })

  it('uses AS aliases for headers while still resolving from the real field', () => {
    const result = runQuery(
      parseQuery('TABLE title AS "Name", priority AS "P" FROM threads WHERE id = beta'),
      { rows, propertyDefs },
    )
    expect(result.columns).toEqual(['Name', 'P'])
    expect(result.columnFields).toEqual(['title', 'priority'])
    expect(result.rows[0].cells).toEqual(['Beta draft', 'low'])
  })

  it('keeps an aliased column editable via its underlying field', () => {
    const result = runQuery(
      parseQuery('TABLE title, priority AS "P" FROM threads EDITABLE priority'),
      { rows, propertyDefs },
    )
    expect(result.editable).toEqual(['priority'])
    expect(result.columnFields[1]).toBe('priority')
  })

  it('has an empty editable list when the clause is absent', () => {
    expect(runQuery(parseQuery('LIST FROM threads'), { rows, propertyDefs }).editable).toEqual([])
  })
})
