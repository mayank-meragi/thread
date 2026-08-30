import {
  QueryParseError,
  type ComparisonOp,
  type Expr,
  type FieldRef,
  type Literal,
  type Query,
  type SelectClause,
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

const OPERATORS = ['>=', '<=', '!=', '=', '>', '<']

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
      if (j >= src.length) throw new QueryParseError('Unterminated string literal.', i)
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

    throw new QueryParseError(`Unexpected character ${JSON.stringify(ch)}.`, i)
  }
  tokens.push({ type: 'eof', value: '', pos: src.length })
  return tokens
}

// ---------------------------------------------------------------------------
// Parser (recursive descent)
// ---------------------------------------------------------------------------

const CLAUSE_KEYWORDS = new Set(['from', 'where', 'editable', 'sort', 'limit'])

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
      throw new QueryParseError(`Expected ${word.toUpperCase()}.`, this.peek().pos)
    }
  }

  parse(): Query {
    const select = this.parseSelect()
    this.expectKeyword('from')
    const source = this.parseSource()
    const query: Query = { select, source }

    if (this.eatKeyword('where')) query.where = this.parseExpr()
    if (this.eatKeyword('editable')) query.editable = this.parseFieldList()
    if (this.eatKeyword('sort')) query.sort = this.parseSort()
    if (this.eatKeyword('limit')) query.limit = this.parseLimit()

    if (this.peek().type !== 'eof') {
      throw new QueryParseError(`Unexpected ${this.describe(this.peek())}.`, this.peek().pos)
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
      return { kind: 'list', columns: this.startsField() ? this.parseFieldList() : [] }
    }
    if (this.eatKeyword('table')) {
      return { kind: 'table', columns: this.parseFieldList() }
    }
    throw new QueryParseError('A query must start with LIST or TABLE.', this.peek().pos)
  }

  // Is the next token the start of a field name (not a clause keyword)?
  private startsField(): boolean {
    const token = this.peek()
    if (token.type === 'string') return true
    if (token.type !== 'ident') return false
    const lower = token.value.toLowerCase()
    return !CLAUSE_KEYWORDS.has(lower) && !['and', 'or', 'not'].includes(lower)
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
    if (token.type === 'ident' && (token.value.toLowerCase() === 'threads' || token.value.toLowerCase() === 'tags')) {
      this.next()
      return token.value.toLowerCase() as SourceName
    }
    throw new QueryParseError('FROM must name a source: threads or tags.', token.pos)
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
      throw new QueryParseError('LIMIT expects a whole number.', token.pos)
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
      throw new QueryParseError('Expected a field name.', token.pos)
    }
    const lower = token.value.toLowerCase()
    if (CLAUSE_KEYWORDS.has(lower) || ['and', 'or', 'not'].includes(lower)) {
      throw new QueryParseError(`${token.value.toUpperCase()} is a reserved word; quote it to use it as a value.`, token.pos)
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
    if (token.type === 'ident') {
      const lower = token.value.toLowerCase()
      if (lower === 'or') return false
      if (CLAUSE_KEYWORDS.has(lower)) return false
      return true
    }
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
        throw new QueryParseError('Expected a closing parenthesis.', this.peek().pos)
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
    throw new QueryParseError('Expected a value after the operator.', token.pos)
  }
}

export function parseQuery(src: string): Query {
  return new Parser(src).parse()
}
