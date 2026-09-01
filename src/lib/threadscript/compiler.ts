import { z } from 'zod'
import { commandRegistry, type CommandDefinition, type CommandRegistry, type CommandRisk } from '../commands'
import { parseQuery } from '../query/grammar'
import { normalizeThreadScriptSource } from './tokenizer'
import {
  ThreadScriptDiagnostic,
  isCompiledReference,
  type ActionNode,
  type CompiledReference,
  type CompiledThreadScript,
  type SourceSpan,
  type ThreadScriptAst,
  type ThreadScriptDiagnosticData,
  type ThreadScriptValidationResult,
  type ValueNode,
} from './types'
import { parseThreadScript } from './parser'

type JsonSchema = {
  type?: string | string[]
  enum?: unknown[]
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
}

function diagnostic(code: ConstructorParameters<typeof ThreadScriptDiagnostic>[0]['code'], message: string, span: SourceSpan): ThreadScriptDiagnostic {
  return new ThreadScriptDiagnostic({ code, message, ...span })
}

function valueToRuntime(value: ValueNode, aliases: Map<string, { actionIndex: number }>): unknown {
  if (value.kind === 'string' || value.kind === 'symbol' || value.kind === 'number' || value.kind === 'boolean') return value.value
  if (value.kind === 'null') return null
  if (value.kind === 'reference') {
    const target = aliases.get(value.alias)
    if (!target) throw diagnostic('invalid-reference', `Reference $${value.alias}.${value.path.join('.')} must point to an earlier aliased action.`, value.span)
    return { $result: { alias: value.alias, actionIndex: target.actionIndex, path: value.path } } satisfies CompiledReference
  }
  if (value.kind === 'list') return value.items.map((item) => valueToRuntime(item, aliases))
  return Object.fromEntries(value.entries.map((entry) => [entry.key, valueToRuntime(entry.value, aliases)]))
}

function schemaAtPath(schema: JsonSchema, path: readonly string[]): JsonSchema | undefined {
  if (schema.anyOf) return schema.anyOf.map((candidate) => schemaAtPath(candidate, path)).find(Boolean)
  if (schema.oneOf) return schema.oneOf.map((candidate) => schemaAtPath(candidate, path)).find(Boolean)
  if (path.length === 0) return schema
  return schema.properties?.[path[0]] ? schemaAtPath(schema.properties[path[0]], path.slice(1)) : undefined
}

function placeholderFor(schema: JsonSchema): unknown {
  if (schema.enum?.length) return schema.enum[0]
  if (schema.anyOf) return placeholderFor(schema.anyOf[0])
  if (schema.oneOf) return placeholderFor(schema.oneOf[0])
  const type = Array.isArray(schema.type) ? schema.type.find((item) => item !== 'null') ?? schema.type[0] : schema.type
  if (type === 'string') return '__threadscript_reference__'
  if (type === 'number' || type === 'integer') return 0
  if (type === 'boolean') return false
  if (type === 'array') return []
  if (type === 'object') return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, child]) => [key, placeholderFor(child)]))
  if (type === 'null') return null
  return '__threadscript_reference__'
}

function materializeReferences(value: unknown, prior: CommandDefinition[], span: SourceSpan): unknown {
  if (isCompiledReference(value)) {
    const source = prior[value.$result.actionIndex]
    const outputSchema = z.toJSONSchema(source.outputSchema) as JsonSchema
    const referenced = schemaAtPath(outputSchema, value.$result.path)
    if (!referenced) throw diagnostic('invalid-reference', `Command ${source.name} has no result field ${JSON.stringify(value.$result.path.join('.'))}.`, span)
    return placeholderFor(referenced)
  }
  if (Array.isArray(value)) return value.map((item) => materializeReferences(item, prior, span))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, materializeReferences(item, prior, span)]))
  return value
}

function restoreReferences(original: unknown, parsed: unknown): unknown {
  if (isCompiledReference(original)) return original
  if (Array.isArray(original) && Array.isArray(parsed)) return parsed.map((item, index) => restoreReferences(original[index], item))
  if (original && parsed && typeof original === 'object' && typeof parsed === 'object') {
    const originalRecord = original as Record<string, unknown>
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, restoreReferences(originalRecord[key], value)]))
  }
  return parsed
}

function findArgumentSpan(action: ActionNode, path: PropertyKey[]): SourceSpan {
  const first = path[0]
  if (typeof first !== 'string') return action.span
  return action.arguments.entries.find((entry) => entry.key === first)?.span ?? action.span
}

function closestCommands(name: string, registry: CommandRegistry): string[] {
  function distance(a: string, b: string): number {
    const matrix = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0))
    for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i
    for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      }
    }
    return matrix[a.length][b.length]
  }
  return registry.list().map((item) => item.name).sort((a, b) => distance(name, a) - distance(name, b)).slice(0, 3)
}

function getPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, value)
}

function validateQueries(command: CommandDefinition, argumentsValue: unknown, action: ActionNode): void {
  for (const path of command.queryArgumentPaths ?? []) {
    const query = getPath(argumentsValue, path)
    if (typeof query !== 'string') throw diagnostic('invalid-query', `Query argument ${path} must be a string.`, findArgumentSpan(action, [path.split('.')[0]]))
    try {
      const parsed = parseQuery(query)
      if (parsed.editable?.length) throw new Error('EDITABLE is not allowed in a ThreadScript selector.')
    } catch (error) {
      throw diagnostic('invalid-query', error instanceof Error ? error.message : String(error), findArgumentSpan(action, [path.split('.')[0]]))
    }
  }
}

function sourceHash(source: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function planRisk(risks: readonly CommandRisk[]): CommandRisk {
  if (risks.includes('external')) return 'external'
  if (risks.includes('destructive')) return 'destructive'
  return 'write'
}

export function compileThreadScript(source: string, registry: CommandRegistry = commandRegistry): CompiledThreadScript {
  const normalized = normalizeThreadScriptSource(source)
  const ast = parseThreadScript(normalized)
  const aliases = new Map<string, { actionIndex: number }>()
  const prior: CommandDefinition[] = []
  const actions = ast.actions.map((action, actionIndex) => {
    const command = registry.get(action.capability)
    if (!command) {
      const suggestions = closestCommands(action.capability, registry)
      const suffix = suggestions.length ? ` Did you mean ${suggestions.map((item) => JSON.stringify(item)).join(', ')}?` : ''
      throw diagnostic('unknown-command', `Unknown command ${JSON.stringify(action.capability)}.${suffix}`, action.span)
    }
    const runtime = valueToRuntime(action.arguments, aliases)
    const materialized = materializeReferences(runtime, prior, action.span)
    const result = command.inputSchema.safeParse(materialized)
    if (!result.success) {
      const issue = result.error.issues[0]
      const issuePath = issue.path.length
        ? issue.path
        : 'keys' in issue && Array.isArray(issue.keys) && issue.keys.length
          ? [issue.keys[0]]
          : []
      throw diagnostic('invalid-arguments', issue.message, findArgumentSpan(action, issuePath))
    }
    const argumentsValue = restoreReferences(runtime, result.data)
    validateQueries(command, argumentsValue, action)
    prior.push(command)
    if (action.alias) aliases.set(action.alias, { actionIndex })
    return {
      id: `action-${actionIndex + 1}`,
      actionIndex,
      capability: action.capability,
      alias: action.alias,
      arguments: argumentsValue,
      risk: command.risk,
      idempotency: command.idempotency,
      span: action.span,
    }
  })
  return {
    languageVersion: 1,
    description: ast.description,
    source: normalized,
    sourceHash: sourceHash(normalized),
    risk: planRisk(actions.map((action) => action.risk)),
    actions,
  }
}

function diagnosticData(error: unknown): ThreadScriptDiagnosticData {
  if (error instanceof ThreadScriptDiagnostic) return {
    code: error.code,
    message: error.message,
    line: error.line,
    column: error.column,
    length: error.length,
  }
  return { code: 'invalid-document', message: error instanceof Error ? error.message : String(error), line: 1, column: 1, length: 0 }
}

export function validateThreadScript(source: string, registry: CommandRegistry = commandRegistry): ThreadScriptValidationResult {
  let ast: ThreadScriptAst | undefined
  try {
    ast = parseThreadScript(source)
    return { ast, plan: compileThreadScript(source, registry), diagnostics: [] }
  } catch (error) {
    return { ast, diagnostics: [diagnosticData(error)] }
  }
}
