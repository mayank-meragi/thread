import * as chrono from 'chrono-node'
import type { PropertyDefinitionRecord, PropertyType } from '../blockMetadata'
import type { ComparisonOp, Expr, Literal, Query, ResultRow, Row, RunResult, QueryValue } from './types'

// Same normalisation `definitionId` uses in db.ts, so a field written as
// "Due date", "due-date" or "due_date" all resolve to the one property.
export function slugifyField(name: string): string {
  return name.trim().toLocaleLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

const BUILT_IN_FIELD_TYPES: Record<string, PropertyType> = {
  created: 'date',
  updated: 'date',
  'created-at': 'date',
  'updated-at': 'date',
  usage: 'number',
  'property-count': 'number',
  estimate: 'number',
  'estimate-minutes': 'number',
}

function buildTypeIndex(defs: PropertyDefinitionRecord[]): Map<string, PropertyType> {
  const index = new Map<string, PropertyType>(Object.entries(BUILT_IN_FIELD_TYPES))
  for (const def of defs) {
    index.set(def.id, def.type)
    index.set(slugifyField(def.name), def.type)
  }
  return index
}

function resolveField(row: Row, name: string): QueryValue {
  if (row.fields.has(name)) return row.fields.get(name)
  const lower = name.toLowerCase()
  if (row.fields.has(lower)) return row.fields.get(lower)
  const slug = slugifyField(name)
  for (const [key, value] of row.fields) {
    if (slugifyField(key) === slug) return value
  }
  return undefined
}

function isTruthy(value: QueryValue): boolean {
  if (value == null) return false
  if (value === false) return false
  if (value === '') return false
  if (Array.isArray(value)) return value.length > 0
  return true
}

function toTime(value: unknown): number | null {
  if (value == null) return null
  if (value instanceof Date) return value.getTime()
  const text = String(value).trim()
  if (!text) return null
  const iso = Date.parse(text)
  if (!Number.isNaN(iso)) return iso
  const parsed = chrono.parseDate(text, new Date())
  return parsed ? parsed.getTime() : null
}

function toBool(value: QueryValue): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  return isTruthy(value)
}

function literalText(literal: Literal): string {
  if (literal.type === 'string') return literal.value
  if (literal.type === 'number') return String(literal.value)
  if (literal.type === 'boolean') return String(literal.value)
  return ''
}

function compareOrdinal(op: ComparisonOp, sign: number): boolean {
  switch (op) {
    case '>': return sign > 0
    case '<': return sign < 0
    case '>=': return sign >= 0
    case '<=': return sign <= 0
    case '=': return sign === 0
    case '!=': return sign !== 0
    default: return false
  }
}

function compare(op: ComparisonOp, left: QueryValue, literal: Literal, type: PropertyType | undefined): boolean {
  if (op === 'contains') {
    const needle = literalText(literal).toLowerCase()
    if (Array.isArray(left)) return left.some((item) => String(item).toLowerCase().includes(needle))
    return String(left ?? '').toLowerCase().includes(needle)
  }

  if (literal.type === 'null') {
    if (op === '=') return left == null
    if (op === '!=') return left != null
    return false
  }

  // A missing field satisfies only an inequality; it never orders before or
  // after a concrete value.
  if (left == null) return op === '!='

  // Numeric comparison when the field or the literal is numeric.
  const wantNumber = type === 'number' || literal.type === 'number'
  if (wantNumber) {
    const ln = typeof left === 'number' ? left : Number(String(left ?? '').trim())
    const rn = literal.type === 'number' ? literal.value : Number(literalText(literal))
    if (!Number.isNaN(ln) && !Number.isNaN(rn)) return compareOrdinal(op, Math.sign(ln - rn))
  }

  if (type === 'date' || type === 'datetime') {
    const lt = toTime(left)
    const rt = toTime(literalText(literal))
    if (lt != null && rt != null) return compareOrdinal(op, Math.sign(lt - rt))
  }

  if (literal.type === 'boolean') {
    const lb = toBool(left)
    if (op === '=') return lb === literal.value
    if (op === '!=') return lb !== literal.value
  }

  // String comparison. `=` / `!=` also treat an array field as a membership test.
  const rs = literalText(literal).toLowerCase()
  if ((op === '=' || op === '!=') && Array.isArray(left)) {
    const hit = left.some((item) => String(item).toLowerCase() === rs)
    return op === '=' ? hit : !hit
  }
  const ls = String(left ?? '').toLowerCase()
  return compareOrdinal(op, Math.sign(ls.localeCompare(rs)))
}

function evalExpr(expr: Expr, row: Row, types: Map<string, PropertyType>): boolean {
  switch (expr.kind) {
    case 'and': return evalExpr(expr.left, row, types) && evalExpr(expr.right, row, types)
    case 'or': return evalExpr(expr.left, row, types) || evalExpr(expr.right, row, types)
    case 'not': return !evalExpr(expr.expr, row, types)
    case 'group': return evalExpr(expr.expr, row, types)
    case 'truthy': return isTruthy(resolveField(row, expr.field.name))
    case 'compare': {
      const left = resolveField(row, expr.field.name)
      const type = types.get(expr.field.name) ?? types.get(slugifyField(expr.field.name))
      return compare(expr.op, left, expr.value, type)
    }
  }
}

function sortValue(value: QueryValue): { num: number | null; text: string } {
  if (value == null) return { num: null, text: '' }
  if (typeof value === 'number') return { num: value, text: String(value) }
  const time = toTime(value)
  if (time != null && /[-:t]/i.test(String(value))) return { num: time, text: String(value) }
  const asNum = Number(value)
  return { num: Number.isNaN(asNum) ? null : asNum, text: String(value).toLowerCase() }
}

const DEFAULT_LIST_FIELD: Record<Query['source'], string> = { threads: 'title', tags: 'name' }

export function runQuery(
  query: Query,
  ctx: { rows: Row[]; propertyDefs: PropertyDefinitionRecord[] },
): RunResult {
  const types = buildTypeIndex(ctx.propertyDefs)

  let rows = query.where ? ctx.rows.filter((row) => evalExpr(query.where!, row, types)) : [...ctx.rows]

  if (query.sort) {
    const { field, dir } = query.sort
    const factor = dir === 'desc' ? -1 : 1
    rows = rows
      .map((row, index) => ({ row, index, key: sortValue(resolveField(row, field.name)) }))
      .sort((a, b) => {
        const sign = a.key.num != null && b.key.num != null
          ? Math.sign(a.key.num - b.key.num)
          : a.key.text.localeCompare(b.key.text)
        return sign !== 0 ? sign * factor : a.index - b.index
      })
      .map((entry) => entry.row)
  }

  if (typeof query.limit === 'number') rows = rows.slice(0, Math.max(0, query.limit))

  // `columnFields` resolves cell values and matches editable properties;
  // `columns` is only what the header shows (the alias when one was given).
  const selected = query.select.columns
  const columnFields = query.select.kind === 'table'
    ? selected.map((column) => column.name)
    : [DEFAULT_LIST_FIELD[query.source], ...selected.map((column) => column.name)]
  const columns = query.select.kind === 'table'
    ? selected.map((column) => column.alias ?? column.name)
    : [DEFAULT_LIST_FIELD[query.source], ...selected.map((column) => column.alias ?? column.name)]

  const resultRows: ResultRow[] = rows.map((row) => ({
    id: row.id,
    link: row.link,
    cells: columnFields.map((name) => resolveField(row, name) ?? null),
  }))

  return {
    columns,
    columnFields,
    rows: resultRows,
    editable: (query.editable ?? []).map((field) => slugifyField(field.name)),
  }
}
