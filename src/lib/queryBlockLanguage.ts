import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language'
import { QUERY_BLOCK_LANGUAGE } from './queryBlockPlugin'
import { tqlStreamParser } from './query/highlight'

// Registers `tql` in the code-block language dropdown and gives it syntax
// highlighting via a small StreamLanguage (see `query/highlight.ts`). The parser
// there shares its keyword tables with the real query parser.
export const queryLanguageDescription = LanguageDescription.of({
  name: QUERY_BLOCK_LANGUAGE,
  alias: [QUERY_BLOCK_LANGUAGE],
  load: async () => new LanguageSupport(StreamLanguage.define(tqlStreamParser)),
})
