import { tokenizeThreadScript, type LineToken } from './tokenizer'
import {
  ThreadScriptDiagnostic,
  type ActionNode,
  type ListValueNode,
  type MapEntryNode,
  type MapValueNode,
  type SourceSpan,
  type ThreadScriptAst,
  type ValueNode,
} from './types'

const ACTION_NAME = '[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+'
const ALIAS = '[a-z][a-zA-Z0-9]*'
const ACTION_PATTERN = new RegExp(`^action (${ACTION_NAME})(?: as (${ALIAS}))?$`)
const SYMBOL_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/
const NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/
const REFERENCE_PATTERN = /^\$([a-z][a-zA-Z0-9]*)\.([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*)$/

function span(line: LineToken, column = line.indent + 1, length = Math.max(line.text.length, 1)): SourceSpan {
  return { line: line.line, column, length }
}

function fail(line: LineToken, code: ConstructorParameters<typeof ThreadScriptDiagnostic>[0]['code'], message: string, column = line.indent + 1, length = Math.max(line.text.length, 1)): never {
  throw new ThreadScriptDiagnostic({ code, message, line: line.line, column, length })
}

function isTrivia(line: LineToken | undefined): boolean {
  return !!line && (line.kind === 'blank' || line.kind === 'comment')
}

function parseQuotedString(text: string, line: LineToken, column: number): string {
  if (!text.endsWith('"') || text.length === 1) fail(line, 'unterminated-string', 'Unterminated quoted string.', column, text.length)
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'string') throw new Error('not a string')
    return value
  } catch {
    fail(line, 'invalid-value', 'Invalid quoted string or escape sequence.', column, text.length)
  }
}

function commonIndent(lines: readonly string[]): number {
  const nonEmpty = lines.filter((line) => line.trim() !== '')
  if (!nonEmpty.length) return 0
  return Math.min(...nonEmpty.map((line) => line.match(/^ */)?.[0].length ?? 0))
}

class Parser {
  private index = 0

  constructor(private readonly lines: LineToken[]) {}

  parse(): ThreadScriptAst {
    this.skipTrivia()
    let description: string | undefined
    const current = this.lines[this.index]
    if (current?.indent === 0 && current.text.startsWith('plan')) {
      description = this.parsePlan(current)
      this.index += 1
    }

    const actions: ActionNode[] = []
    const aliases = new Set<string>()
    while (true) {
      this.skipTrivia()
      const line = this.lines[this.index]
      if (!line) break
      if (line.indent !== 0) fail(line, 'invalid-indentation', 'Top-level declarations must not be indented.')
      const match = ACTION_PATTERN.exec(line.text)
      if (!match) fail(line, 'invalid-action', 'Expected an action declaration such as `action thread.create`.')
      const [, capability, alias] = match
      if (alias && aliases.has(alias)) fail(line, 'duplicate-alias', `Action alias ${JSON.stringify(alias)} is already in use.`)
      if (alias) aliases.add(alias)
      const actionLine = line
      this.index += 1
      const argumentsValue = this.parseMap(2, true)
      if (argumentsValue.entries.length === 0) fail(actionLine, 'invalid-action', `Action ${capability} must contain at least one argument.`)
      actions.push({ capability, alias, arguments: argumentsValue, span: span(actionLine) })
    }

    if (actions.length === 0) {
      const line = this.lines.find((candidate) => candidate.kind === 'content') ?? { kind: 'content', line: 1, indent: 0, text: '', raw: '' } satisfies LineToken
      fail(line, 'invalid-document', 'A ThreadScript document must contain at least one action.')
    }
    return { languageVersion: 1, description, actions }
  }

  private parsePlan(line: LineToken): string {
    if (!line.text.startsWith('plan ')) fail(line, 'invalid-document', 'PLAN must be followed by a quoted description.')
    const value = line.text.slice(5).trim()
    if (!value.startsWith('"')) fail(line, 'invalid-value', 'The plan description must be a quoted string.', line.indent + 6, value.length)
    return parseQuotedString(value, line, line.indent + 6)
  }

  private skipTrivia(): void {
    while (isTrivia(this.lines[this.index])) this.index += 1
  }

  private nextContentIndex(start = this.index): number {
    let next = start
    while (isTrivia(this.lines[next])) next += 1
    return next
  }

  private parseMap(indent: number, stopAtTopLevel = false): MapValueNode {
    const entries: MapEntryNode[] = []
    const keys = new Set<string>()
    const startLine = this.lines[this.nextContentIndex()] ?? this.lines[Math.max(this.index - 1, 0)]
    while (true) {
      this.skipTrivia()
      const line = this.lines[this.index]
      if (!line || line.indent < indent || (stopAtTopLevel && line.indent === 0)) break
      if (line.indent !== indent) fail(line, 'invalid-indentation', `Expected ${indent} spaces of indentation.`)
      if (line.text.startsWith('-')) fail(line, 'unexpected-token', 'A list item is not valid where a mapping key is expected.')
      const colon = line.text.indexOf(':')
      if (colon <= 0) fail(line, 'unexpected-token', 'Expected an argument in `name: value` form.')
      const key = line.text.slice(0, colon).trim()
      if (!key) fail(line, 'unexpected-token', 'Mapping keys cannot be empty.')
      if (keys.has(key)) fail(line, 'duplicate-key', `Duplicate key ${JSON.stringify(key)}.`, line.indent + 1, colon)
      keys.add(key)
      const rawValue = line.text.slice(colon + 1).trim()
      const entrySpan = span(line, line.indent + 1, colon)
      this.index += 1
      const value = this.parseValueAfterKey(line, rawValue, indent, colon)
      entries.push({ key, value, span: entrySpan })
    }
    return { kind: 'map', entries, span: startLine ? span(startLine) : { line: 1, column: 1, length: 0 } }
  }

  private parseValueAfterKey(line: LineToken, rawValue: string, indent: number, colon: number): ValueNode {
    const valueColumn = line.indent + colon + 2 + (line.text.slice(colon + 1).length - line.text.slice(colon + 1).trimStart().length)
    if (rawValue === '"""') return this.parseMultiline(line, indent, valueColumn)
    if (rawValue) return this.parseScalar(rawValue, line, valueColumn)

    const nextIndex = this.nextContentIndex()
    const next = this.lines[nextIndex]
    if (!next || next.indent <= indent) fail(line, 'invalid-value', 'A mapping key without a value must contain an indented map or list.')
    if (next.indent !== indent + 2) fail(next, 'invalid-indentation', `Expected ${indent + 2} spaces of indentation.`)
    this.index = nextIndex
    return next.text.startsWith('-') ? this.parseList(indent + 2) : this.parseMap(indent + 2)
  }

  private parseMultiline(opening: LineToken, indent: number, column: number): ValueNode {
    const content: string[] = []
    while (this.index < this.lines.length) {
      const line = this.lines[this.index]
      if (line.indent === indent && line.text === '"""') {
        this.index += 1
        const dedent = commonIndent(content)
        const value = content.map((raw) => raw.trim() === '' ? '' : raw.slice(dedent)).join('\n')
        return { kind: 'string', value, multiline: true, span: span(opening, column, 3) }
      }
      content.push(line.raw)
      this.index += 1
    }
    fail(opening, 'unterminated-string', 'Unterminated multiline string.', column, 3)
  }

  private parseList(indent: number): ListValueNode {
    const items: ValueNode[] = []
    const first = this.lines[this.index]
    let itemShape: 'map' | 'scalar' | undefined
    while (true) {
      this.skipTrivia()
      const line = this.lines[this.index]
      if (!line || line.indent < indent) break
      if (line.indent !== indent || !line.text.startsWith('-')) {
        if (line.indent === indent) break
        fail(line, 'invalid-indentation', `Expected a list item at ${indent} spaces of indentation.`)
      }
      const rest = line.text.slice(1).trimStart()
      if (!rest) fail(line, 'invalid-value', 'List items must have a value in v1.')
      const colon = rest.indexOf(':')
      if (colon > 0 && !rest.startsWith('"')) {
        if (itemShape === 'scalar') fail(line, 'invalid-value', 'A list cannot mix scalar and mapping items.')
        itemShape = 'map'
        const key = rest.slice(0, colon).trim()
        const rawValue = rest.slice(colon + 1).trim()
        const itemEntries: MapEntryNode[] = []
        this.index += 1
        itemEntries.push({
          key,
          value: rawValue && rawValue !== '"""'
            ? this.parseScalar(rawValue, line, line.indent + line.text.indexOf(rawValue) + 1)
            : this.parseValueAfterKey(line, rawValue, indent + 2, line.text.indexOf(':')),
          span: span(line, line.indent + 3, key.length),
        })
        const continuation = this.nextContentIndex()
        if (this.lines[continuation]?.indent === indent + 2 && !this.lines[continuation].text.startsWith('-')) {
          this.index = continuation
          const tail = this.parseMap(indent + 2)
          const keys = new Set([key])
          for (const entry of tail.entries) {
            if (keys.has(entry.key)) fail(this.lines[continuation], 'duplicate-key', `Duplicate key ${JSON.stringify(entry.key)}.`)
            keys.add(entry.key)
            itemEntries.push(entry)
          }
        }
        items.push({ kind: 'map', entries: itemEntries, span: span(line) })
      } else {
        if (itemShape === 'map') fail(line, 'invalid-value', 'A list cannot mix mapping and scalar items.')
        itemShape = 'scalar'
        this.index += 1
        items.push(this.parseScalar(rest, line, line.indent + 3))
      }
    }
    return { kind: 'list', items, span: first ? span(first) : { line: 1, column: 1, length: 0 } }
  }

  private parseScalar(text: string, line: LineToken, column: number): ValueNode {
    const scalarSpan = span(line, column, text.length)
    if (text.startsWith('"')) return { kind: 'string', value: parseQuotedString(text, line, column), multiline: false, span: scalarSpan }
    if (text === 'true' || text === 'false') return { kind: 'boolean', value: text === 'true', span: scalarSpan }
    if (text === 'null') return { kind: 'null', span: scalarSpan }
    if (NUMBER_PATTERN.test(text)) return { kind: 'number', value: Number(text), span: scalarSpan }
    const reference = REFERENCE_PATTERN.exec(text)
    if (reference) return { kind: 'reference', alias: reference[1], path: reference[2].split('.'), span: scalarSpan }
    if (SYMBOL_PATTERN.test(text) || DATE_PATTERN.test(text)) return { kind: 'symbol', value: text, span: scalarSpan }
    fail(line, 'invalid-value', `Invalid value ${JSON.stringify(text)}. Quote text containing spaces or punctuation.`, column, text.length)
  }
}

export function parseThreadScript(source: string): ThreadScriptAst {
  return new Parser(tokenizeThreadScript(source)).parse()
}
