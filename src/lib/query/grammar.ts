import {
  CLAUSE_KEYWORDS,
  LOGIC_KEYWORDS,
  OPERATORS,
  RESERVED,
  SOURCE_NAMES,
} from './keywords'
import {
  QueryParseError,
  type ComparisonOp,
  type Expr,
  type FieldRef,
  type Literal,
  type Query,
  type SelectClause,
  type SelectColumn,
  type SortDir,
  type SourceName,
} from './types'

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType = 'ident' | 'string' | 'number' | 'op' | 'punct' | 'eof'

interface Token {
  type: TokenType
  value: string
  pos: number
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i += 1; continue }

    if (ch === '"') {
      let value = ''
      let j = i + 1
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length) { value += src[j + 1]; j += 2; continue }
        value += src[j]
        j += 1
      }
      if (j >= src.length) throw new QueryParseError('Unterminated string literal — add a closing quote.', i, src.length - i)
      tokens.push({ type: 'string', value, pos: i })
      i = j + 1
      continue
    }

    // ISO date / datetime literal, kept whole so `2026-09-01` isn't lexed as
    // `2026` minus `09` minus `01`.
    const dateMatch = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/.exec(src.slice(i))
    if (dateMatch) { tokens.push({ type: 'string', value: dateMatch[0], pos: i }); i += dateMatch[0].length; continue }

    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const match = /^-?[0-9]+(\.[0-9]+)?/.exec(src.slice(i))
      if (match) { tokens.push({ type: 'number', value: match[0], pos: i }); i += match[0].length; continue }
    }

    const op = OPERATORS.find((candidate) => src.startsWith(candidate, i))
    if (op) { tokens.push({ type: 'op', value: op, pos: i }); i += op.length; continue }

    if (ch === '(' || ch === ')' || ch === ',') {
      tokens.push({ type: 'punct', value: ch, pos: i })
      i += 1
      continue
    }

    // Identifier: letters, digits, underscore, dot and hyphen (property slugs
    // such as `estimate-minutes`, dotted refs such as `prop.status`).
    const identMatch = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(src.slice(i))
    if (identMatch) { tokens.push({ type: 'ident', value: identMatch[0], pos: i }); i += identMatch[0].length; continue }

    throw new QueryParseError(`Unexpected character ${JSON.stringify(ch)}.`, i, 1)
  }
  tokens.push({ type: 'eof', value: '', pos: src.length })
  return tokens
}

// ---------------------------------------------------------------------------
// Parser (recursive descent)
// ---------------------------------------------------------------------------

// Words that end a field position: a following clause, FROM, or a connective.
const FIELD_BOUNDARY = new Set<string>(['from', ...CLAUSE_KEYWORDS, ...LOGIC_KEYWORDS])
// Words that end a WHERE term (NOT still starts one, so it's excluded here).
const TERM_BOUNDARY = new Set<string>(['and', 'or', 'from', ...CLAUSE_KEYWORDS])

// Character span of a token, for error underlining. EOF has no span.
function tokenSpan(token: Token): number {
  if (token.type === 'eof') return 0
  if (token.type === 'string') return Math.max(token.value.length + 2, 1)
  return Math.max(token.value.length, 1)
}

class Parser {
  private tokens: Token[]
  private index = 0

  constructor(src: string) {
    this.tokens = tokenize(src)
  }

  private peek(): Token {
    return this.tokens[this.index]
  }

  private next(): Token {
    return this.tokens[this.index++]
  }

  private isKeyword(word: string): boolean {
    const token = this.peek()
    return token.type === 'ident' && token.value.toLowerCase() === word
  }

  private eatKeyword(word: string): boolean {
    if (this.isKeyword(word)) { this.index += 1; return true }
    return false
  }

  private expectKeyword(word: string): void {
    if (!this.eatKeyword(word)) {
      const token = this.peek()
      throw new QueryParseError(`Expected ${word.toUpperCase()}, found ${this.describe(token)}.`, token.pos, tokenSpan(token))
    }
  }

  private fail(message: string, token: Token = this.peek()): never {
    throw new QueryParseError(message, token.pos, tokenSpan(token))
  }

  parse(): Query {
    const select = this.parseSelect()
    this.expectKeyword('from')
    const source = this.parseSource()
    const query: Query = { select, source }

    // WHERE / EDITABLE / SORT / LIMIT may appear in any order, each at most once.
    const seen = new Set<string>()
    while (this.peek().type !== 'eof') {
      const token = this.peek()
      const clause = token.type === 'ident' ? token.value.toLowerCase() : ''
      if (!CLAUSE_KEYWORDS.has(clause)) {
        this.fail(`Unexpected ${this.describe(token)}. Expected a clause (WHERE, EDITABLE, SORT, LIMIT) or end of query.`, token)
      }
      if (seen.has(clause)) this.fail(`Duplicate ${clause.toUpperCase()} clause.`, token)
      seen.add(clause)
      this.next()
      if (clause === 'where') query.where = this.parseExpr()
      else if (clause === 'editable') query.editable = this.parseFieldList()
      else if (clause === 'sort') query.sort = this.parseSort()
      else query.limit = this.parseLimit()
    }
    return query
  }

  private describe(token: Token): string {
    if (token.type === 'eof') return 'end of query'
    return JSON.stringify(token.value)
  }

  private parseSelect(): SelectClause {
    if (this.eatKeyword('list')) {
      // Extra fields are optional for LIST; they render as chips beside each item.
      return { kind: 'list', columns: this.startsField() ? this.parseSelectColumns() : [] }
    }
    if (this.eatKeyword('table')) {
      return { kind: 'table', columns: this.parseSelectColumns() }
    }
    this.fail('A query must start with LIST or TABLE.')
  }

  // Is the next token the start of a field name (not a clause / connective)?
  private startsField(): boolean {
    const token = this.peek()
    if (token.type === 'string') return true
    if (token.type !== 'ident') return false
    return !FIELD_BOUNDARY.has(token.value.toLowerCase())
  }

  // A comma-separated column list where each column may carry `AS <alias>`.
  private parseSelectColumns(): SelectColumn[] {
    const columns: SelectColumn[] = [this.parseSelectColumn()]
    while (this.peek().type === 'punct' && this.peek().value === ',') {
      this.next()
      columns.push(this.parseSelectColumn())
    }
    return columns
  }

  private parseSelectColumn(): SelectColumn {
    const { name } = this.parseField()
    if (!this.eatKeyword('as')) return { name }
    const token = this.peek()
    if (token.type === 'string') { this.next(); return { name, alias: token.value } }
    if (token.type === 'ident' && !RESERVED.has(token.value.toLowerCase())) {
      this.next()
      return { name, alias: token.value }
    }
    return this.fail('Expected a column name after AS.', token)
  }

  private parseFieldList(): FieldRef[] {
    const fields: FieldRef[] = [this.parseField()]
    while (this.peek().type === 'punct' && this.peek().value === ',') {
      this.next()
      fields.push(this.parseField())
    }
    return fields
  }

  private parseSource(): SourceName {
    const token = this.peek()
    if (token.type === 'ident' && SOURCE_NAMES.has(token.value.toLowerCase())) {
      this.next()
      return token.value.toLowerCase() as SourceName
    }
    return this.fail('FROM must name a source: threads or tags.', token)
  }

  private parseSort(): { field: FieldRef; dir: SortDir } {
    const field = this.parseField()
    let dir: SortDir = 'asc'
    if (this.eatKeyword('asc')) dir = 'asc'
    else if (this.eatKeyword('desc')) dir = 'desc'
    return { field, dir }
  }

  private parseLimit(): number {
    const token = this.peek()
    if (token.type !== 'number' || !/^\d+$/.test(token.value)) {
      return this.fail('LIMIT expects a whole number.', token)
    }
    this.next()
    return Number(token.value)
  }

  private parseField(): FieldRef {
    const token = this.peek()
    if (token.type === 'string') {
      this.next()
      return { name: token.value }
    }
    if (token.type !== 'ident') {
      this.fail(`Expected a field name, found ${this.describe(token)}.`, token)
    }
    const lower = token.value.toLowerCase()
    if (RESERVED.has(lower)) {
      this.fail(`${token.value.toUpperCase()} is a reserved word; quote it to use it as a field name.`, token)
    }
    this.next()
    return { name: token.value.replace(/^prop\./i, '') }
  }

  private parseExpr(): Expr {
    return this.parseOr()
  }

  private parseOr(): Expr {
    let left = this.parseAnd()
    while (this.eatKeyword('or')) {
      left = { kind: 'or', left, right: this.parseAnd() }
    }
    return left
  }

  private startsTerm(): boolean {
    const token = this.peek()
    if (token.type === 'eof') return false
    if (token.type === 'punct') return token.value === '('
    if (token.type === 'ident') return !TERM_BOUNDARY.has(token.value.toLowerCase())
    return false
  }

  private parseAnd(): Expr {
    let left = this.parseNot()
    // AND is optional between terms: `a = 1 b = 2` is `a = 1 AND b = 2`.
    while (true) {
      if (this.eatKeyword('and')) {
        left = { kind: 'and', left, right: this.parseNot() }
        continue
      }
      if (this.startsTerm()) {
        left = { kind: 'and', left, right: this.parseNot() }
        continue
      }
      return left
    }
  }

  private parseNot(): Expr {
    if (this.eatKeyword('not')) return { kind: 'not', expr: this.parseNot() }
    return this.parseComparison()
  }

  private parseComparison(): Expr {
    if (this.peek().type === 'punct' && this.peek().value === '(') {
      this.next()
      const expr = this.parseExpr()
      if (!(this.peek().type === 'punct' && this.peek().value === ')')) {
        this.fail(`Expected a closing parenthesis, found ${this.describe(this.peek())}.`)
      }
      this.next()
      return { kind: 'group', expr }
    }

    const field = this.parseField()
    const op = this.tryParseOperator()
    if (!op) return { kind: 'truthy', field }
    return { kind: 'compare', field, op, value: this.parseLiteral() }
  }

  private tryParseOperator(): ComparisonOp | null {
    const token = this.peek()
    if (token.type === 'op') {
      this.next()
      return token.value as ComparisonOp
    }
    if (token.type === 'ident' && token.value.toLowerCase() === 'contains') {
      this.next()
      return 'contains'
    }
    return null
  }

  private parseLiteral(): Literal {
    const token = this.peek()
    if (token.type === 'string') { this.next(); return { type: 'string', value: token.value } }
    if (token.type === 'number') { this.next(); return { type: 'number', value: Number(token.value) } }
    if (token.type === 'ident') {
      const lower = token.value.toLowerCase()
      if (lower === 'true' || lower === 'false') { this.next(); return { type: 'boolean', value: lower === 'true' } }
      if (lower === 'null') { this.next(); return { type: 'null' } }
      // Bare word -> string value, so `status = active` works without quotes.
      this.next()
      return { type: 'string', value: token.value }
    }
    return this.fail(`Expected a value after the operator, found ${this.describe(token)}.`, token)
  }
}

export function parseQuery(src: string): Query {
  return new Parser(src).parse()
}
