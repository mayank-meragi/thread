// Value space the query engine works in. Property values from the store are
// string | number | boolean | string[] | null; `undefined` means "field absent".
export type QueryValue = string | number | boolean | string[] | null | undefined

export type SourceName = 'threads' | 'tags'

export interface FieldRef {
  name: string
}

export type SelectClause =
  | { kind: 'list'; columns: FieldRef[] }
  | { kind: 'table'; columns: FieldRef[] }

export type ComparisonOp = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains'

export type Literal =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'null' }

export type Expr =
  | { kind: 'and'; left: Expr; right: Expr }
  | { kind: 'or'; left: Expr; right: Expr }
  | { kind: 'not'; expr: Expr }
  | { kind: 'group'; expr: Expr }
  | { kind: 'compare'; field: FieldRef; op: ComparisonOp; value: Literal }
  | { kind: 'truthy'; field: FieldRef }

export type SortDir = 'asc' | 'desc'

export interface Query {
  select: SelectClause
  source: SourceName
  where?: Expr
  // Fields the result should render as editable inputs (see `EDITABLE` clause).
  editable?: FieldRef[]
  sort?: { field: FieldRef; dir: SortDir }
  limit?: number
}

export class QueryParseError extends Error {
  position: number
  constructor(message: string, position: number) {
    super(message)
    this.name = 'QueryParseError'
    this.position = position
  }
}

// One source record, normalised. `fields` is keyed by both the property id and
// the slugified property name (see sources.ts); `resolveField` also slug-matches.
export interface Row {
  id: string
  fields: Map<string, QueryValue>
  link: string
}

export interface ResultRow {
  id: string
  link: string
  cells: QueryValue[]
}

export interface RunResult {
  columns: string[]
  rows: ResultRow[]
  // Slugified names of the fields the query marked `EDITABLE`.
  editable: string[]
}

// future: GROUP BY, FLATTEN, functions/arithmetic, TASK/CALENDAR outputs,
// joins across sources. The clause order in `Query` leaves room for them.
