import { z } from 'zod'

export type CommandRisk = 'write' | 'destructive' | 'external'
export type CommandIdempotency = 'natural' | 'receipt-required'

export interface CommandTarget {
  kind: 'thread' | 'template' | 'property' | 'persona' | 'workout'
  id: string
  label: string
  version?: string | number
}

export type CommandChangeKind = 'create' | 'update' | 'append' | 'replace' | 'remove'

export interface CommandChange {
  kind: CommandChangeKind
  target: CommandTarget
  description: string
  field?: string
  before?: unknown
  after?: unknown
}

export interface CommandPreview {
  summary: string
  changes: CommandChange[]
  warnings?: string[]
}

// During whole-plan resolution, entities an earlier step will create do not
// exist in the database yet. The resolver threads this index through so
// `resolveThread` / `resolveProperty` can still resolve a reference to
// something a prior action produces. Keys are every spelling a later action
// might use: the stable id, the raw title/name, and its lower-cased form.
export interface PendingEntityIndex {
  threads: Map<string, { id: string; title: string; isTemplate?: boolean }>
  properties: Map<string, { id: string; name: string; type?: string }>
}

export interface CommandResolutionContext {
  activePersonaId?: string
  pendingEntities?: PendingEntityIndex
}

export interface CommandExecutionContext {
  idempotencyKey: string
}

export interface CommandMetadata {
  name: string
  summary: string
  category: string
  keywords: readonly string[]
  example: string
  risk: CommandRisk
  idempotency: CommandIdempotency
  queryArgumentPaths?: readonly string[]
}

export interface CommandSpec<Input, Resolved, Output> extends CommandMetadata {
  inputSchema: z.ZodType<Input>
  outputSchema: z.ZodType<Output>
  resolve: (input: Input, context: CommandResolutionContext) => Promise<Resolved>
  preview: (resolved: Resolved) => Promise<CommandPreview> | CommandPreview
  execute: (resolved: Resolved, context: CommandExecutionContext) => Promise<Output>
}

export interface CommandDefinition extends CommandMetadata {
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  resolve: (input: unknown, context: CommandResolutionContext) => Promise<unknown>
  preview: (resolved: unknown) => Promise<CommandPreview>
  execute: (resolved: unknown, context: CommandExecutionContext) => Promise<unknown>
}

export interface PreparedCommand {
  capability: string
  input: unknown
  resolved: unknown
  preview: CommandPreview
  risk: CommandRisk
  idempotency: CommandIdempotency
}

export function defineCommand<Input, Resolved, Output>(spec: CommandSpec<Input, Resolved, Output>): CommandDefinition {
  return {
    name: spec.name,
    summary: spec.summary,
    category: spec.category,
    keywords: spec.keywords,
    example: spec.example,
    risk: spec.risk,
    idempotency: spec.idempotency,
    queryArgumentPaths: spec.queryArgumentPaths,
    inputSchema: spec.inputSchema,
    outputSchema: spec.outputSchema,
    resolve: async (raw, context) => spec.resolve(spec.inputSchema.parse(raw), context),
    preview: async (resolved) => spec.preview(resolved as Resolved),
    execute: async (resolved, context) => spec.outputSchema.parse(await spec.execute(resolved as Resolved, context)),
  }
}
