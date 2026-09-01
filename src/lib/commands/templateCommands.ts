import { z } from 'zod'
import { applyThreadTemplate, createThread, db, saveThreadNote, setThreadIsTemplate, setThreadProperty, validatePropertyValue } from '../../db'
import { normalizePropertyValue, type PropertyValue } from '../dayDocument'
import { slugifyThread } from '../outline'
import { parseThreadDocument } from '../threadDocument'
import { findThreadByTitle, resolveProperty, resolveThread, threadTarget } from './resolve'
import { propertyValueSchema, threadEntityResultSchema, threadMutationResultSchema } from './schemas'
import { appendThreadMarkdown } from './threadCommands'
import { defineCommand, type CommandDefinition, type CommandTarget } from './types'

const create = defineCommand({
  name: 'template.create',
  summary: 'Create a template thread with Markdown content and existing properties.',
  category: 'templates',
  keywords: ['template', 'create', 'scaffold', 'reusable'],
  example: 'action template.create as weekly\n  title: "Weekly Review"\n  content: "- Wins\\n- Challenges"',
  risk: 'write',
  idempotency: 'receipt-required',
  inputSchema: z.object({
    title: z.string().trim().min(1),
    content: z.string().default('- '),
    properties: z.record(z.string(), propertyValueSchema).default({}),
  }).strict(),
  outputSchema: threadEntityResultSchema,
  resolve: async (input, context) => {
    const existing = await findThreadByTitle(input.title, context) ?? await db.threads.get(slugifyThread(input.title))
    if (existing) throw new Error(`Thread “${existing.title}” already exists. Use template.enable or edit it explicitly.`)
    const properties = await Promise.all(Object.entries(input.properties).map(async ([reference, rawValue]) => {
      const property = await resolveProperty(reference, context)
      const value = normalizePropertyValue(rawValue) as PropertyValue
      validatePropertyValue(property, value)
      return { property, value }
    }))
    return { input, properties }
  },
  preview: ({ input, properties }) => {
    const target: CommandTarget = { kind: 'template', id: slugifyThread(input.title), label: input.title }
    return {
      summary: `Create template “${input.title}”`,
      changes: [
        {
          kind: 'create',
          target,
          description: `Create template “${input.title}”`,
          after: { title: input.title, content: input.content },
        },
        ...properties.map(({ property, value }) => ({
          kind: 'update' as const,
          target,
          field: property.name,
          description: `Set “${property.name}” on the new template`,
          before: undefined,
          after: value,
        })),
      ],
    }
  },
  execute: async ({ input, properties }) => {
    const id = await createThread(input.title)
    if (input.content.trim()) await saveThreadNote(id, input.content)
    for (const { property, value } of properties) await setThreadProperty(id, property.id, value)
    await setThreadIsTemplate(id, true)
    return { thread: id, created: true }
  },
})

function templateToggle(name: 'template.enable' | 'template.disable', value: boolean): CommandDefinition {
  return defineCommand({
    name,
    summary: value ? 'Mark a thread as a reusable template.' : 'Remove template status without deleting the thread.',
    category: 'templates',
    keywords: ['template', value ? 'enable' : 'disable', value ? 'mark' : 'remove'],
    example: value
      ? 'action template.enable\n  thread: "Weekly Review"'
      : 'action template.disable\n  thread: "Weekly Review"',
    risk: 'write',
    idempotency: 'natural',
    inputSchema: z.object({ thread: z.string().trim().min(1) }).strict(),
    outputSchema: threadMutationResultSchema,
    resolve: async (input, context) => ({ input, thread: await resolveThread(input.thread, undefined, context) }),
    preview: ({ thread }) => {
      const changed = !!thread.isTemplate !== value
      return {
        summary: value ? `Mark “${thread.title}” as a template` : `Remove template status from “${thread.title}”`,
        changes: changed ? [{
          kind: 'update',
          target: threadTarget(thread, value ? 'template' : 'thread'),
          field: 'isTemplate',
          description: value ? 'Enable template status' : 'Disable template status',
          before: !!thread.isTemplate,
          after: value,
        }] : [],
      }
    },
    execute: async ({ thread }) => {
      const changed = !!thread.isTemplate !== value
      if (changed) await setThreadIsTemplate(thread.id, value)
      return { thread: thread.id, changed }
    },
  })
}

const apply = defineCommand({
  name: 'template.apply',
  summary: 'Append a template body and non-conflicting properties to a thread.',
  category: 'templates',
  keywords: ['template', 'apply', 'thread', 'scaffold'],
  example: 'action template.apply\n  template: "Weekly Review"\n  thread: "Project Atlas"',
  risk: 'write',
  idempotency: 'receipt-required',
  inputSchema: z.object({ template: z.string().trim().min(1), thread: z.string().trim().min(1) }).strict(),
  outputSchema: threadMutationResultSchema,
  resolve: async (input, context) => {
    const [template, thread] = await Promise.all([
      resolveThread(input.template, { template: true }, context),
      resolveThread(input.thread, undefined, context),
    ])
    if (template.id === thread.id) throw new Error('A template cannot be applied to itself.')
    const [templateNote, targetNote] = await Promise.all([
      db.threadNotes.get(template.id),
      db.threadNotes.get(thread.id),
    ])
    if (!templateNote) throw new Error('This template has no note content.')
    const source = parseThreadDocument(templateNote.markdown)
    const beforeBody = targetNote ? parseThreadDocument(targetNote.markdown).markdown : '- '
    const afterBody = appendThreadMarkdown(beforeBody, source.markdown)
    const beforeTags = targetNote?.metadata?.tags ?? []
    const afterTags = Array.from(new Set([...beforeTags, ...(source.metadata.tags ?? [])]))
    const properties = await Promise.all(Object.entries(source.metadata.properties).map(async ([propertyId, value]) => {
      const property = await resolveProperty(propertyId, context)
      validatePropertyValue(property, value)
      return {
        property,
        value,
        existing: await db.threadProperties.get(`${thread.id}:${propertyId}`),
      }
    }))
    return { input, template, thread, beforeBody, afterBody, beforeTags, afterTags, properties }
  },
  preview: ({ template, thread, beforeBody, afterBody, beforeTags, afterTags, properties }) => ({
    summary: `Apply “${template.title}” to “${thread.title}”`,
    changes: [
      ...(beforeBody === afterBody ? [] : [{
        kind: 'append' as const,
        target: threadTarget(thread),
        field: 'content',
        description: `Append content from “${template.title}”`,
        before: beforeBody,
        after: afterBody,
      }]),
      ...(beforeTags.length === afterTags.length ? [] : [{
        kind: 'update' as const,
        target: threadTarget(thread),
        field: 'tags',
        description: `Merge tags from “${template.title}”`,
        before: beforeTags,
        after: afterTags,
      }]),
      ...properties.filter(({ existing }) => existing?.source !== 'explicit').map(({ property, value, existing }) => ({
        kind: 'update' as const,
        target: threadTarget(thread),
        field: property.name,
        description: `Apply template property “${property.name}”`,
        before: existing?.value,
        after: value,
      })),
    ],
  }),
  execute: async ({ template, thread, beforeBody, afterBody, beforeTags, afterTags, properties }) => {
    await applyThreadTemplate(thread.id, template.id)
    return {
      thread: thread.id,
      changed: beforeBody !== afterBody
        || beforeTags.length !== afterTags.length
        || properties.some(({ existing }) => existing?.source !== 'explicit'),
    }
  },
})

export const templateCommands: readonly CommandDefinition[] = [
  create,
  templateToggle('template.enable', true),
  templateToggle('template.disable', false),
  apply,
]
