import type { CommandIdempotency, CommandPreview, CommandRisk, CommandTarget } from '../commands/types'

export interface SourceSpan {
  line: number
  column: number
  length: number
}

export type ScalarValueNode =
  | { kind: 'string'; value: string; multiline: boolean; span: SourceSpan }
  | { kind: 'symbol'; value: string; span: SourceSpan }
  | { kind: 'number'; value: number; span: SourceSpan }
  | { kind: 'boolean'; value: boolean; span: SourceSpan }
  | { kind: 'null'; span: SourceSpan }
  | { kind: 'reference'; alias: string; path: string[]; span: SourceSpan }

export interface MapEntryNode {
  key: string
  value: ValueNode
  span: SourceSpan
}

export interface MapValueNode {
  kind: 'map'
  entries: MapEntryNode[]
  span: SourceSpan
}

export interface ListValueNode {
  kind: 'list'
  items: ValueNode[]
  span: SourceSpan
}

export type ValueNode = ScalarValueNode | MapValueNode | ListValueNode

export interface ActionNode {
  capability: string
  alias?: string
  arguments: MapValueNode
  span: SourceSpan
}

export interface ThreadScriptAst {
  languageVersion: 1
  description?: string
  actions: ActionNode[]
}

export type ThreadScriptDiagnosticCode =
  | 'invalid-indentation'
  | 'unexpected-token'
  | 'invalid-document'
  | 'invalid-action'
  | 'invalid-value'
  | 'duplicate-key'
  | 'duplicate-alias'
  | 'unterminated-string'
  | 'unknown-command'
  | 'invalid-arguments'
  | 'invalid-reference'
  | 'invalid-query'

export interface ThreadScriptDiagnosticData {
  code: ThreadScriptDiagnosticCode
  message: string
  line: number
  column: number
  length: number
}

export class ThreadScriptDiagnostic extends Error implements ThreadScriptDiagnosticData {
  code: ThreadScriptDiagnosticCode
  line: number
  column: number
  length: number

  constructor(data: ThreadScriptDiagnosticData) {
    super(data.message)
    this.name = 'ThreadScriptDiagnostic'
    this.code = data.code
    this.line = data.line
    this.column = data.column
    this.length = data.length
  }
}

export interface CompiledReference {
  $result: {
    alias: string
    actionIndex: number
    path: string[]
  }
}

export interface CompiledAction {
  id: string
  actionIndex: number
  capability: string
  alias?: string
  arguments: unknown
  risk: CommandRisk
  idempotency: CommandIdempotency
  span: SourceSpan
}

export interface CompiledThreadScript {
  languageVersion: 1
  description?: string
  source: string
  sourceHash: string
  risk: CommandRisk
  actions: CompiledAction[]
}

export interface ThreadScriptValidationResult {
  ast?: ThreadScriptAst
  plan?: CompiledThreadScript
  diagnostics: ThreadScriptDiagnosticData[]
}

// ---------------------------------------------------------------------------
// Whole-plan resolution view (produced by `resolvePlan` in ./plan.ts). These
// live here rather than in plan.ts so `src/db.ts` can reference them for the
// persisted `ChatProposalRecord` without importing plan.ts (which imports db).
// ---------------------------------------------------------------------------

export interface PlanStepReference {
  path: string
  fromActionIndex: number
  fromAlias: string
}

export interface PlanStepPreview {
  id: string
  actionIndex: number
  capability: string
  alias?: string
  risk: CommandRisk
  idempotency: CommandIdempotency
  // A real per-command preview, or a synthetic one when `status === 'deferred'`
  // (the step depends on a result only known once an earlier action runs).
  preview: CommandPreview
  status: 'resolved' | 'deferred'
  references: PlanStepReference[]
}

export interface PlanTargetCapture {
  actionIndex: number
  ref: string
  kind: CommandTarget['kind']
  id: string
  exists: boolean
  version?: string | number
}

export interface PlanPreview {
  languageVersion: 1
  description?: string
  source: string
  sourceHash: string
  risk: CommandRisk
  steps: PlanStepPreview[]
  warnings: string[]
}

export function isCompiledReference(value: unknown): value is CompiledReference {
  if (!value || typeof value !== 'object' || !('$result' in value)) return false
  const result = (value as { $result?: unknown }).$result
  return !!result && typeof result === 'object'
    && typeof (result as { alias?: unknown }).alias === 'string'
    && typeof (result as { actionIndex?: unknown }).actionIndex === 'number'
    && Array.isArray((result as { path?: unknown }).path)
}

