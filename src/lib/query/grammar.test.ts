import { describe, expect, it } from 'vitest'
import { parseQuery } from './grammar'
import { QueryParseError } from './types'

describe('parseQuery', () => {
  it('parses a LIST query with just a source', () => {
    expect(parseQuery('LIST FROM threads')).toEqual({
      select: { kind: 'list', columns: [] },
      source: 'threads',
    })
  })

  it('parses LIST with extra fields', () => {
    expect(parseQuery('LIST rating, status FROM threads').select).toEqual({
      kind: 'list',
      columns: [{ name: 'rating' }, { name: 'status' }],
    })
  })

  it('parses an EDITABLE clause', () => {
    const query = parseQuery('TABLE title, rating FROM threads WHERE type = Trip EDITABLE rating, status SORT rating DESC LIMIT 5')
    expect(query.editable).toEqual([{ name: 'rating' }, { name: 'status' }])
    expect(query.sort).toEqual({ field: { name: 'rating' }, dir: 'desc' })
    expect(query.limit).toBe(5)
  })

  it('rejects EDITABLE as a bare field name', () => {
    expect(() => parseQuery('TABLE editable FROM threads')).toThrow(/reserved word/)
  })

  it('accepts clauses in any order', () => {
    const query = parseQuery('TABLE title FROM threads SORT title DESC WHERE type = Trip LIMIT 3')
    expect(query.where).toMatchObject({ kind: 'compare', field: { name: 'type' } })
    expect(query.sort).toEqual({ field: { name: 'title' }, dir: 'desc' })
    expect(query.limit).toBe(3)
  })

  it('rejects a repeated clause', () => {
    expect(() => parseQuery('TABLE title FROM threads SORT title SORT updated')).toThrow(/Duplicate SORT/)
  })

  it('parses AS aliases on TABLE and LIST columns', () => {
    expect(parseQuery('TABLE title AS "Name", start_date AS Started FROM threads').select).toEqual({
      kind: 'table',
      columns: [{ name: 'title', alias: 'Name' }, { name: 'start_date', alias: 'Started' }],
    })
    expect(parseQuery('LIST rating AS Score FROM threads').select).toEqual({
      kind: 'list',
      columns: [{ name: 'rating', alias: 'Score' }],
    })
  })

  it('rejects AS with no name', () => {
    expect(() => parseQuery('TABLE title AS FROM threads')).toThrow(/column name after AS/)
  })

  it('parses TABLE columns', () => {
    const query = parseQuery('TABLE status, priority, updated FROM threads')
    expect(query.select).toEqual({
      kind: 'table',
      columns: [{ name: 'status' }, { name: 'priority' }, { name: 'updated' }],
    })
  })

  it('is case-insensitive for keywords', () => {
    expect(parseQuery('list from tags').source).toBe('tags')
  })

  it('parses WHERE with implicit AND between terms', () => {
    const query = parseQuery('LIST FROM threads WHERE status = active priority = high')
    expect(query.where).toEqual({
      kind: 'and',
      left: { kind: 'compare', field: { name: 'status' }, op: '=', value: { type: 'string', value: 'active' } },
      right: { kind: 'compare', field: { name: 'priority' }, op: '=', value: { type: 'string', value: 'high' } },
    })
  })

  it('parses comparison operators, numbers, booleans and null', () => {
    const query = parseQuery('LIST FROM threads WHERE estimate >= 30 AND done = true AND note != null')
    const and1 = query.where as { kind: 'and'; left: unknown; right: unknown }
    expect(and1.kind).toBe('and')
    expect(query.where).toMatchObject({
      right: { kind: 'compare', field: { name: 'note' }, op: '!=', value: { type: 'null' } },
    })
  })

  it('parses OR and parentheses with correct precedence', () => {
    const query = parseQuery('LIST FROM threads WHERE (a = 1 OR b = 2) AND c = 3')
    expect(query.where?.kind).toBe('and')
    expect((query.where as { left: { kind: string } }).left.kind).toBe('group')
  })

  it('parses NOT, CONTAINS, SORT and LIMIT', () => {
    const query = parseQuery('TABLE title FROM threads WHERE NOT title CONTAINS draft SORT updated DESC LIMIT 5')
    expect(query.where).toEqual({
      kind: 'not',
      expr: { kind: 'compare', field: { name: 'title' }, op: 'contains', value: { type: 'string', value: 'draft' } },
    })
    expect(query.sort).toEqual({ field: { name: 'updated' }, dir: 'desc' })
    expect(query.limit).toBe(5)
  })

  it('treats a bare field with no operator as a truthiness test', () => {
    expect(parseQuery('LIST FROM threads WHERE archived').where).toEqual({
      kind: 'truthy',
      field: { name: 'archived' },
    })
  })

  it('strips a leading prop. prefix from field names', () => {
    expect(parseQuery('LIST FROM threads WHERE prop.status = active').where).toMatchObject({
      field: { name: 'status' },
    })
  })

  it('throws with a position when it does not start with LIST/TABLE', () => {
    try {
      parseQuery('FIND all FROM threads')
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(QueryParseError)
      expect((error as QueryParseError).position).toBe(0)
    }
  })

  it('throws on an unknown source', () => {
    expect(() => parseQuery('LIST FROM notebook')).toThrow(/threads or tags/)
  })

  it('throws on an unterminated string', () => {
    expect(() => parseQuery('LIST FROM threads WHERE title = "oops')).toThrow(QueryParseError)
  })

  it('throws on trailing junk', () => {
    expect(() => parseQuery('LIST FROM threads bogus')).toThrow(QueryParseError)
  })
})
