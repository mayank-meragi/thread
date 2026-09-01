import { z } from 'zod'
import { createPropertyDefinition, db, removeThreadProperty, setThreadProperty, validatePropertyValue } from '../../db'
import { normalizePropertyValue, type PropertyValue } from '../dayDocument'
import { findPropertyByName, resolveProperty, resolveThread, threadTarget } from './resolve'
import { creatablePropertyTypeSchema, propertyEntityResultSchema, propertyValueSchema, threadMutationResultSchema } from './schemas'
import { defineCommand, type CommandDefinition, type CommandResolutionContext } from './types'

const create = defineCommand({
  name: 'property.create',
  summary: 'Create a reusable property definition.',
  category: 'properties',
  keywords: ['property', 'field', 'create', 'schema'],
  example: 'action property.create as reviewDate\n  name: "Review date"\n  type: date',
  risk: 'write',
  idempotency: 'receipt-required',
  inputSchema: z.object({ name: z.string().trim().min(1), type: creatablePropertyTypeSchema }).strict(),
  outputSchema: propertyEntityResultSchema,
  resolve: async (input, context) => ({ input, existing: await findPropertyByName(input.name, context) }),
  preview: ({ input, existing }) => {
    if (existing && existing.type !== input.type) throw new Error(`Property “${existing.name}” already exists with type ${existing.type}.`)
    return {
      summary: existing ? `Use existing property “${existing.name}”` : `Create ${input.type} property “${input.name}”`,
      changes: existing ? [] : [{
        kind: 'create',
        target: { kind: 'property', id: input.name, label: input.name },
        description: `Create ${input.type} property “${input.name}”`,
        after: { name: input.name, type: input.type },
      }],
    }
  },
  execute: async ({ input, existing }) => existing
    ? { property: existing.id, created: false }
    : { property: (await createPropertyDefinition(input)).id, created: true },
})

async function resolveThreadProperty(input: { thread: string; property: string }, context?: CommandResolutionContext) {
  const [thread, property] = await Promise.all([
    resolveThread(input.thread, undefined, context),
    resolveProperty(input.property, context),
  ])
  const existing = await db.threadProperties.get(`${thread.id}:${property.id}`)
  return { input, thread, property, existing }
}

const assign = defineCommand({
  name: 'property.assign',
  summary: 'Assign an existing property to a thread with an empty value.',
  category: 'properties',
  keywords: ['property', 'assign', 'thread', 'field'],
  example: 'action property.assign\n  thread: "Project Atlas"\n  property: "Review date"',
  risk: 'write',
  idempotency: 'natural',
  inputSchema: z.object({ thread: z.string().trim().min(1), property: z.string().trim().min(1) }).strict(),
  outputSchema: threadMutationResultSchema,
  resolve: (input, context) => resolveThreadProperty(input, context),
  preview: ({ thread, property, existing }) => ({
    summary: existing ? `Keep “${property.name}” on “${thread.title}”` : `Add “${property.name}” to “${thread.title}”`,
    changes: existing ? [] : [{
      kind: 'update',
      target: threadTarget(thread),
      field: property.name,
      description: `Assign “${property.name}” with an empty value`,
      before: undefined,
      after: null,
    }],
  }),
  execute: async ({ thread, property, existing }) => {
    if (!existing) await setThreadProperty(thread.id, property.id, null)
    return { thread: thread.id, changed: !existing }
  },
})

const set = defineCommand({
  name: 'property.set',
  summary: 'Set a validated property value on a thread.',
  category: 'properties',
  keywords: ['property', 'set', 'update', 'thread', 'value'],
  example: 'action property.set\n  thread: "Project Atlas"\n  property: Priority\n  value: High',
  risk: 'write',
  idempotency: 'natural',
  inputSchema: z.object({
    thread: z.string().trim().min(1),
    property: z.string().trim().min(1),
    value: propertyValueSchema,
  }).strict(),
  outputSchema: threadMutationResultSchema,
  resolve: async (input, context) => {
    const base = await resolveThreadProperty(input, context)
    const value = normalizePropertyValue(input.value) as PropertyValue
    validatePropertyValue(base.property, value)
    return { ...base, value }
  },
  preview: ({ thread, property, existing, value }) => {
    const changed = JSON.stringify(existing?.value) !== JSON.stringify(value)
    return {
      summary: changed ? `Set “${property.name}” on “${thread.title}”` : `Keep “${property.name}” on “${thread.title}”`,
      changes: changed ? [{
        kind: 'update',
        target: threadTarget(thread),
        field: property.name,
        description: `Set “${property.name}” on “${thread.title}”`,
        before: existing?.value,
        after: value,
      }] : [],
    }
  },
  execute: async ({ thread, property, existing, value }) => {
    const changed = JSON.stringify(existing?.value) !== JSON.stringify(value)
    if (changed) await setThreadProperty(thread.id, property.id, value)
    return { thread: thread.id, changed }
  },
})

const remove = defineCommand({
  name: 'property.remove',
  summary: 'Remove a property assignment and value from a thread.',
  category: 'properties',
  keywords: ['property', 'remove', 'clear', 'thread'],
  example: 'action property.remove\n  thread: "Project Atlas"\n  property: Priority',
  risk: 'destructive',
  idempotency: 'natural',
  inputSchema: z.object({ thread: z.string().trim().min(1), property: z.string().trim().min(1) }).strict(),
  outputSchema: threadMutationResultSchema,
  resolve: (input, context) => resolveThreadProperty(input, context),
  preview: ({ thread, property, existing }) => ({
    summary: existing ? `Remove “${property.name}” from “${thread.title}”` : `“${property.name}” is not assigned to “${thread.title}”`,
    changes: existing ? [{
      kind: 'remove',
      target: threadTarget(thread),
      field: property.name,
      description: `Remove “${property.name}” and its value`,
      before: existing.value,
      after: undefined,
    }] : [],
    warnings: existing?.value == null ? undefined : ['The current property value will be removed.'],
  }),
  execute: async ({ thread, property, existing }) => {
    if (existing) await removeThreadProperty(thread.id, property.id)
    return { thread: thread.id, changed: !!existing }
  },
})

export const propertyCommands: readonly CommandDefinition[] = [create, assign, set, remove]
