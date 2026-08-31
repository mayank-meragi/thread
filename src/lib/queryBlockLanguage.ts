import { LanguageDescription } from '@codemirror/language'
import type { LanguageSupport } from '@codemirror/language'
import { QUERY_BLOCK_LANGUAGE } from './queryBlockPlugin'

// Registers `tql` in the code-block language dropdown. There is no CodeMirror
// grammar for the query DSL, so `load` resolves to no extensions — the block is
// rendered as plain text. `CodeMirrorBlock.updateLanguage()` only reconfigures
// the language compartment on a truthy resolve, and an empty extension array is
// a valid (no-op) configuration.
export const queryLanguageDescription = LanguageDescription.of({
  name: QUERY_BLOCK_LANGUAGE,
  alias: [QUERY_BLOCK_LANGUAGE],
  load: async () => [] as unknown as LanguageSupport,
})
