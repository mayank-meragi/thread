import { db } from '../../db'
import {
  commandRegistry,
  projectCommandOutput,
  type CommandRegistry,
  type CommandResolutionContext,
  type PendingEntityIndex,
  type PreparedCommand,
} from '../commands'
import {
  isCompiledReference,
  type CompiledAction,
  type CompiledThreadScript,
  type PlanPreview,
  type PlanStepPreview,
  type PlanStepReference,
  type PlanTargetCapture,
} from './types'

export interface ResolvedPlan {
  preview: PlanPreview
  // Positionally parallel to `preview.steps`; `null` where the step is deferred.
  prepared: Array<PreparedCommand | null>
  capturedTargets: PlanTargetCapture[]
  expectedVersions: Record<string, string | number>
}

export interface ResolvePlanOptions {
  registry?: CommandRegistry
  resolution?: CommandResolutionContext
}

// Marker returned by reference substitution when the referenced value cannot
// be projected yet -- forces the step onto the deferred path.
const UNRESOLVED = Symbol('threadscript.unresolved')

function getPath(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((current, key) => (current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined), value)
}

function collectReferences(value: unknown, out: PlanStepReference[]): void {
  if (isCompiledReference(value)) {
    out.push({
      path: value.$result.path.join('.'),
      fromActionIndex: value.$result.actionIndex,
      fromAlias: value.$result.alias,
    })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectReferences(item, out))
    return
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectReferences(item, out))
  }
}

function referencesOf(action: CompiledAction): PlanStepReference[] {
  const out: PlanStepReference[] = []
  collectReferences(action.arguments, out)
  return out
}

function substituteReferences(value: unknown, prepared: Array<PreparedCommand | null>): unknown {
  if (isCompiledReference(value)) {
    const source = prepared[value.$result.actionIndex]
    if (!source) return UNRESOLVED
    const projected = projectCommandOutput(source)
    const resolved = getPath(projected, value.$result.path)
    return resolved === undefined ? UNRESOLVED : resolved
  }
  if (Array.isArray(value)) return value.map((item) => substituteReferences(item, prepared))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substituteReferences(item, prepared)]))
  }
  return value
}

function containsUnresolved(value: unknown): boolean {
  if (value === UNRESOLVED) return true
  if (Array.isArray(value)) return value.some(containsUnresolved)
  if (value && typeof value === 'object') return Object.values(value).some(containsUnresolved)
  return false
}

function isResolutionError(error: unknown): boolean {
  return error instanceof Error && /not found|ambiguous/i.test(error.message)
}

function syntheticStep(action: CompiledAction, references: PlanStepReference[]): PlanStepPreview {
  const aliases = Array.from(new Set(references.map((reference) => `$${reference.fromAlias}`))).join(', ')
  return {
    id: action.id,
    actionIndex: action.actionIndex,
    capability: action.capability,
    alias: action.alias,
    risk: action.risk,
    idempotency: action.idempotency,
    status: 'deferred',
    references,
    preview: {
      summary: `${action.capability} — depends on ${aliases || 'an earlier action'} created above`,
      changes: [
        {
          kind: 'update',
          target: { kind: 'thread', id: '', label: 'result of an earlier action' },
          description: references.length
            ? `${action.capability} using ${references.map((reference) => `$${reference.fromAlias}.${reference.path}`).join(', ')}`
            : action.capability,
        },
      ],
      warnings: ['Full preview available after the referenced action runs.'],
    },
  }
}

function registerPending(prepared: PreparedCommand, pending: PendingEntityIndex): void {
  const projected = projectCommandOutput(prepared) as Record<string, unknown> | undefined
  if (!projected) return
  const input = prepared.input as Record<string, unknown>

  if ((prepared.capability === 'thread.create' || prepared.capability === 'template.create') && projected.created && typeof projected.thread === 'string') {
    const title = String(input.title)
    const entry = { id: projected.thread, title, isTemplate: prepared.capability === 'template.create' ? true : undefined }
    for (const key of [projected.thread, title, title.trim().toLocaleLowerCase()]) pending.threads.set(key, entry)
  } else if (prepared.capability === 'property.create' && projected.created && typeof projected.property === 'string') {
    const name = String(input.name)
    const entry = { id: projected.property, name, type: input.type as string | undefined }
    for (const key of [projected.property, name, name.trim().toLocaleLowerCase()]) pending.properties.set(key, entry)
  }
}

// Walks a compiled ThreadScript in order, resolving each action against live
// state (plus entities earlier steps will create), and produces an exact
// preview per step. Side-effect free: it only calls `registry.prepare`
// (asserted non-mutating by the command-registry tests) and reads
// `db.threadNotes`. Throws when a *non-referenced* argument is ambiguous or
// invalid -- such a plan is rejected outright and never persisted.
export async function resolvePlan(compiled: CompiledThreadScript, options: ResolvePlanOptions = {}): Promise<ResolvedPlan> {
  const registry = options.registry ?? commandRegistry
  const pending: PendingEntityIndex = { threads: new Map(), properties: new Map() }
  const prepared: Array<PreparedCommand | null> = []
  const steps: PlanStepPreview[] = []
  const capturedTargets: PlanTargetCapture[] = []
  const expectedVersions: Record<string, string | number> = {}

  for (const action of compiled.actions) {
    const references = referencesOf(action)
    const consumesReference = references.length > 0
    const rawInput = substituteReferences(action.arguments, prepared)

    if (containsUnresolved(rawInput)) {
      steps.push(syntheticStep(action, references))
      prepared.push(null)
      continue
    }

    let step: PreparedCommand
    try {
      step = await registry.prepare(action.capability, rawInput, { ...options.resolution, pendingEntities: pending })
    } catch (error) {
      if (consumesReference && isResolutionError(error)) {
        steps.push(syntheticStep(action, references))
        prepared.push(null)
        continue
      }
      throw error
    }

    steps.push({
      id: action.id,
      actionIndex: action.actionIndex,
      capability: action.capability,
      alias: action.alias,
      risk: action.risk,
      idempotency: action.idempotency,
      status: 'resolved',
      references,
      preview: step.preview,
    })
    prepared.push(step)

    for (const change of step.preview.changes) {
      const ref = `${change.target.kind}:${change.target.id}`
      const exists = change.target.version != null && change.target.version !== ''
      capturedTargets.push({
        actionIndex: action.actionIndex,
        ref,
        kind: change.target.kind,
        id: change.target.id,
        exists,
        version: exists ? change.target.version : undefined,
      })
      if (exists && change.target.version != null) expectedVersions[ref] = change.target.version
      if (change.field === 'content' && (change.target.kind === 'thread' || change.target.kind === 'template')) {
        const note = await db.threadNotes.get(change.target.id)
        if (note) expectedVersions[`threadNote:${change.target.id}`] = note.localRevision
      }
    }

    registerPending(step, pending)
  }

  const warnings: string[] = []
  if (steps.some((step) => step.status === 'deferred')) {
    warnings.push('Some steps are previewed from projected results and re-checked on confirm.')
  }
  const destructiveCount = steps.filter((step) => step.risk === 'destructive').length
  if (destructiveCount) warnings.push(`${destructiveCount} step(s) replace or remove existing content.`)

  return {
    preview: {
      languageVersion: 1,
      description: compiled.description,
      source: compiled.source,
      sourceHash: compiled.sourceHash,
      risk: compiled.risk,
      steps,
      warnings,
    },
    prepared,
    capturedTargets,
    expectedVersions,
  }
}

// Key-order-stable JSON, for comparing a re-computed preview against the one
// the user approved (see ./dispatch.ts).
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]))
  }
  return value
}
