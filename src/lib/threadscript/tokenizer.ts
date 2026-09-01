import { ThreadScriptDiagnostic } from './types'

export type LineTokenKind = 'blank' | 'comment' | 'content'

export interface LineToken {
  kind: LineTokenKind
  line: number
  indent: number
  text: string
  raw: string
}

export function normalizeThreadScriptSource(source: string): string {
  return source.replace(/\r\n?/g, '\n')
}

export function tokenizeThreadScript(source: string): LineToken[] {
  return normalizeThreadScriptSource(source).split('\n').map((raw, index) => {
    const leading = raw.match(/^[ \t]*/)?.[0] ?? ''
    const tab = leading.indexOf('\t')
    if (tab >= 0) {
      throw new ThreadScriptDiagnostic({
        code: 'invalid-indentation',
        message: 'Tabs are not allowed in ThreadScript indentation.',
        line: index + 1,
        column: tab + 1,
        length: 1,
      })
    }
    const indent = leading.length
    const text = raw.slice(indent)
    const kind: LineTokenKind = text === '' ? 'blank' : text.startsWith('#') ? 'comment' : 'content'
    return { kind, line: index + 1, indent, text, raw }
  })
}

