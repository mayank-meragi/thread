// Shared vocabulary for the tql tokenizers. Both the parser (`grammar.ts`) and
// the editor highlighter (`highlight.ts`) key off these sets, so the two can't
// drift on what counts as a keyword.

// Clauses that follow `FROM <source>`, each allowed at most once and in any order.
export const CLAUSE_KEYWORDS = new Set(['where', 'editable', 'sort', 'limit'])

// The output selector a query must start with.
export const SELECT_KEYWORDS = new Set(['list', 'table'])

// Boolean connectives inside WHERE.
export const LOGIC_KEYWORDS = new Set(['and', 'or', 'not'])

// Words that modify a neighbouring token rather than standing alone.
export const MODIFIER_KEYWORDS = new Set(['as', 'asc', 'desc', 'contains'])

// Valid `FROM` sources.
export const SOURCE_NAMES = new Set(['threads', 'tags'])

// Bare-word literals.
export const LITERAL_KEYWORDS = new Set(['true', 'false', 'null'])

// Comparison operators, longest first so `>=` wins over `>`.
export const OPERATORS = ['>=', '<=', '!=', '=', '>', '<']

// Every reserved word: cannot be used as a bare (unquoted) field name.
export const RESERVED = new Set<string>([
  'from',
  ...CLAUSE_KEYWORDS,
  ...SELECT_KEYWORDS,
  ...LOGIC_KEYWORDS,
  ...MODIFIER_KEYWORDS,
])

// Everything the highlighter should paint as a keyword.
export const HIGHLIGHT_KEYWORDS = new Set<string>([
  'from',
  ...CLAUSE_KEYWORDS,
  ...SELECT_KEYWORDS,
  ...LOGIC_KEYWORDS,
  ...MODIFIER_KEYWORDS,
  ...SOURCE_NAMES,
])
