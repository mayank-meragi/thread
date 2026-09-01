import { db, type PersonaRecord, type ThreadRecord } from '../../db'
import type { PropertyDefinitionRecord } from '../blockMetadata'
import { slugifyThread } from '../outline'
import type { CommandResolutionContext, CommandTarget } from './types'

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase()
}

// A thread/property an earlier plan step will create has no database row yet;
// synthesize a record-shaped stub from the pending index. Empty `updatedAt`
// is load-bearing: `threadTarget()` copies it onto `CommandTarget.version`,
// and the plan resolver reads a blank version as "will be created", not
// "already exists".
function pendingThreadStub(entry: { id: string; title: string; isTemplate?: boolean }): ThreadRecord {
  return {
    id: entry.id,
    title: entry.title,
    normalizedTitle: normalized(entry.title),
    createdAt: '',
    updatedAt: '',
    ...(entry.isTemplate ? { isTemplate: true } : {}),
  }
}

function pendingPropertyStub(entry: { id: string; name: string; type?: string }): PropertyDefinitionRecord {
  return {
    id: entry.id,
    name: entry.name,
    type: (entry.type ?? 'text') as PropertyDefinitionRecord['type'],
    createdAt: '',
    updatedAt: '',
  }
}

function lookupPendingThread(
  reference: string,
  context: CommandResolutionContext | undefined,
): { id: string; title: string; isTemplate?: boolean } | undefined {
  const pending = context?.pendingEntities?.threads
  if (!pending) return undefined
  return pending.get(reference) ?? pending.get(slugifyThread(reference)) ?? pending.get(normalized(reference))
}

function lookupPendingProperty(
  reference: string,
  context: CommandResolutionContext | undefined,
): { id: string; name: string; type?: string } | undefined {
  const pending = context?.pendingEntities?.properties
  if (!pending) return undefined
  return pending.get(reference) ?? pending.get(normalized(reference))
}

export async function resolveThread(
  reference: string,
  options?: { template?: boolean },
  context?: CommandResolutionContext,
): Promise<ThreadRecord> {
  const clean = reference.trim()
  const byId = await db.threads.get(clean)
  const candidates = byId
    ? [byId]
    : await db.threads.filter((thread) => normalized(thread.title) === normalized(clean)).toArray()
  const filtered = options?.template ? candidates.filter((thread) => thread.isTemplate) : candidates
  if (filtered.length === 0) {
    const pending = lookupPendingThread(clean, context)
    if (pending && (!options?.template || pending.isTemplate)) return pendingThreadStub(pending)
    throw new Error(options?.template ? `Template ${JSON.stringify(reference)} was not found.` : `Thread ${JSON.stringify(reference)} was not found.`)
  }
  if (filtered.length > 1) throw new Error(`${options?.template ? 'Template' : 'Thread'} ${JSON.stringify(reference)} is ambiguous.`)
  return filtered[0]
}

export async function findThreadByTitle(title: string, context?: CommandResolutionContext): Promise<ThreadRecord | undefined> {
  const matches = await db.threads.filter((thread) => normalized(thread.title) === normalized(title)).toArray()
  if (matches.length > 1) throw new Error(`Thread title ${JSON.stringify(title)} is ambiguous.`)
  if (matches[0]) return matches[0]
  const pending = lookupPendingThread(title.trim(), context)
  return pending ? pendingThreadStub(pending) : undefined
}

export async function resolveProperty(reference: string, context?: CommandResolutionContext): Promise<PropertyDefinitionRecord> {
  const clean = reference.trim()
  const byId = await db.propertyDefinitions.get(clean)
  const candidates = byId
    ? [byId]
    : await db.propertyDefinitions.filter((property) => normalized(property.name) === normalized(clean)).toArray()
  if (candidates.length === 0) {
    const pending = lookupPendingProperty(clean, context)
    if (pending) return pendingPropertyStub(pending)
    throw new Error(`Property ${JSON.stringify(reference)} was not found.`)
  }
  if (candidates.length > 1) throw new Error(`Property ${JSON.stringify(reference)} is ambiguous.`)
  return candidates[0]
}

export async function findPropertyByName(name: string, context?: CommandResolutionContext): Promise<PropertyDefinitionRecord | undefined> {
  const matches = await db.propertyDefinitions.filter((property) => normalized(property.name) === normalized(name)).toArray()
  if (matches.length > 1) throw new Error(`Property name ${JSON.stringify(name)} is ambiguous.`)
  if (matches[0]) return matches[0]
  const pending = lookupPendingProperty(name.trim(), context)
  return pending ? pendingPropertyStub(pending) : undefined
}

export async function resolvePersona(reference: string, activePersonaId?: string): Promise<PersonaRecord> {
  const clean = reference.trim()
  if (normalized(clean) === 'current') {
    if (!activePersonaId) throw new Error('No active persona is available for this command.')
    const active = await db.personas.get(activePersonaId)
    if (!active) throw new Error('The active persona no longer exists.')
    return active
  }
  const byId = await db.personas.get(clean)
  const candidates = byId
    ? [byId]
    : await db.personas.filter((persona) => !persona.archivedAt && normalized(persona.name) === normalized(clean)).toArray()
  if (candidates.length === 0) throw new Error(`Persona ${JSON.stringify(reference)} was not found.`)
  if (candidates.length > 1) throw new Error(`Persona ${JSON.stringify(reference)} is ambiguous.`)
  return candidates[0]
}

export function threadTarget(thread: ThreadRecord, kind: 'thread' | 'template' = thread.isTemplate ? 'template' : 'thread'): CommandTarget {
  return { kind, id: thread.id, label: thread.title, version: thread.updatedAt }
}

export function propertyTarget(property: PropertyDefinitionRecord): CommandTarget {
  return { kind: 'property', id: property.id, label: property.name, version: property.updatedAt }
}

export function personaTarget(persona: PersonaRecord): CommandTarget {
  return { kind: 'persona', id: persona.id, label: persona.name, version: persona.updatedAt }
}
