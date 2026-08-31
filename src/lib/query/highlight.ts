import type { StreamParser } from '@codemirror/language'
import { HIGHLIGHT_KEYWORDS, LITERAL_KEYWORDS } from './keywords'

// A tolerant, single-pass tokenizer for CodeMirror's StreamLanguage. It shares
// the keyword vocabulary with the real parser (`grammar.ts` / `keywords.ts`) but
// must never throw — it only paints tokens, it doesn't validate structure. The
// returned strings are CodeMirror's standard token names, which `basicSetup`'s
// default highlight style already colours.
export const tqlStreamParser: StreamParser<unknown> = {
  name: 'tql',
  token(stream) {
    if (stream.eatSpace()) return null

    // Double-quoted string; the trailing `"?` keeps an unclosed string painted
    // to the end of the line instead of bailing.
    if (stream.match(/^"(?:\\.|[^"\\])*"?/)) return 'string'

    // ISO date / datetime kept whole, mirroring the parser's lexer.
    if (stream.match(/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/)) return 'string'

    if (stream.match(/^-?\d+(?:\.\d+)?/)) return 'number'

    if (stream.match(/^(?:>=|<=|!=|=|>|<)/)) return 'operator'

    if (stream.match(/^[(),]/)) return null

    if (stream.match(/^[A-Za-z_][A-Za-z0-9_.-]*/)) {
      const word = stream.current().toLowerCase()
      if (HIGHLIGHT_KEYWORDS.has(word)) return 'keyword'
      if (LITERAL_KEYWORDS.has(word)) return 'atom'
      return 'variableName'
    }

    stream.next()
    return null
  },
}
