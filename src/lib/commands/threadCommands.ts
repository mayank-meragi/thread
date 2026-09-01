import { z } from 'zod'
import { createThread, db, renameThread, saveThreadNote } from '../../db'
import { slugifyThread } from '../outline'
import { parseThreadDocument } from '../threadDocument'
import { findThreadByTitle, resolveThread, threadTarget } from './resolve'
import { threadEntityResultSchema, threadMutationResultSchema } from './schemas'
import { defineCommand, type CommandDefinition } from './types'

function bodyOf(markdown: string | undefined): string {
  return markdown ? parseThreadDocument(markdown).markdown : '- '
}

export function appendThreadMarkdown(current: string, addition: string): string {
  const cleanAddition = addition.trim()
  if (!cleanAddition) return current
  const isEmpty = current.trim() === '' || current.trim() === '-'
  return isEmpty ? cleanAddition : `${current.replace(/\s+$/, '')}\n\n${cleanAddition}`
}

const create = defineCommand({
  name: 'thread.create',
  summary: 'Create a new thread without overwriting an existing thread.',
  category: 'threads',
  keywords: ['thread', 'create', 'new'],
  example: 'action thread.create as project\n  title: "Project Atlas"',
  risk: 'write',
  idempotency: 'natural',
  inputSchema: z.object({ title: z.string().trim().min(1) }).strict(),
  outputSchema: threadEntityResultSchema,
  resolve: async (input, context) => ({
    input,
    existing: await findThreadByTitle(input.title, context) ?? await db.threads.get(slugifyThread(input.title)),
  }),
  preview: ({ input, existing }) => ({
    summary: existing ? `Use existing thread “${existing.title}”` : `Create thread “${input.title}”`,
    changes: existing ? [] : [{
      kind: 'create',
      target: { kind: 'thread', id: slugifyThread(input.title), label: input.title },
      description: `Create thread “${input.title}”`,
      after: { title: input.title },
    }],
  }),
  execute: async ({ input, existing }) => existing
    ? { thread: existing.id, created: false }
    : { thread: await createThread(input.title), created: true },
})

const rename = defineCommand({
  name: 'thread.rename',
  summary: 'Rename a thread while preserving its stable ID.',
  category: 'threads',
  keywords: ['thread', 'rename', 'title'],
  example: 'action thread.rename\n  thread: "Project Atlas"\n  title: "Atlas Launch"',
  risk: 'write',
  idempotency: 'natural',
  inputSchema: z.object({ thread: z.string().trim().min(1), title: z.string().trim().min(1) }).strict(),
  outputSchema: threadMutationResultSchema,
  resolve: async (input, context) => ({ input, thread: await resolveThread(input.thread, undefined, context) }),
  preview: ({ input, thread }) => ({
    summary: thread.title === input.title ? `Keep thread name “${thread.title}”` : `Rename “${thread.title}” to “${input.title}”`,
    changes: thread.title === input.title ? [] : [{
      kind: 'update',
      target: threadTarget(thread),
      field: 'title',
      description: `Rename “${thread.title}” to “${input.title}”`,
      before: thread.title,
      after: input.title,
    }],
  }),
  execute: async ({ input, thread }) => {
    const changed = thread.title !== input.title
    if (changed) await renameThread(thread.id, input.title)
    return { thread: thread.id, changed }
  },
})

const appendContent = defineCommand({
  name: 'thread.content.append',
  summary: 'Append Markdown to a thread note.',
  category: 'threads',
  keywords: ['thread', 'content', 'append', 'note'],
  example: 'action thread.content.append\n  thread: "Project Atlas"\n  content: "- Next step"',
  risk: 'write',
  idempotency: 'receipt-required',
  inputSchema: z.object({ thread: z.string().trim().min(1), content: z.string().min(1) }).strict(),
  outputSchema: threadMutationResultSchema,
  resolve: async (input, context) => {
    const thread = await resolveThread(input.thread, undefined, context)
    const note = await db.threadNotes.get(thread.id)
    const before = bodyOf(note?.markdown)
    return { input, thread, before, after: appendThreadMarkdown(before, input.content) }
  },
  preview: ({ thread, before, after }) => ({
    summary: before === after ? `No content to append to “${thread.title}”` : `Append content to “${thread.title}”`,
    changes: before === after ? [] : [{
      kind: 'append',
      target: threadTarget(thread),
      field: 'content',
      description: `Append Markdown to “${thread.title}”`,
      before,
      after,
    }],
  }),
  execute: async ({ thread, before, after }) => {
    const changed = before !== after
    if (changed) await saveThreadNote(thread.id, after)
    return { thread: thread.id, changed }
  },
})

const replaceContent = defineCommand({
  name: 'thread.content.replace',
  summary: 'Replace all Markdown content in a thread note.',
  category: 'threads',
  keywords: ['thread', 'content', 'replace', 'overwrite'],
  example: 'action thread.content.replace\n  thread: "Project Atlas"\n  content: "- Replacement outline"',
  risk: 'destructive',
  idempotency: 'natural',
  inputSchema: z.object({ thread: z.string().trim().min(1), content: z.string() }).strict(),
  outputSchema: threadMutationResultSchema,
  resolve: async (input, context) => {
    const thread = await resolveThread(input.thread, undefined, context)
    const note = await db.threadNotes.get(thread.id)
    return { input, thread, before: bodyOf(note?.markdown), after: input.content }
  },
  preview: ({ thread, before, after }) => ({
    summary: before === after ? `Keep existing content in “${thread.title}”` : `Replace content in “${thread.title}”`,
    changes: before === after ? [] : [{
      kind: 'replace',
      target: threadTarget(thread),
      field: 'content',
      description: `Replace all Markdown in “${thread.title}”`,
      before,
      after,
    }],
    warnings: before === after ? undefined : ['This replaces the thread’s complete note body.'],
  }),
  execute: async ({ thread, before, after }) => {
    const changed = before !== after
    if (changed) await saveThreadNote(thread.id, after)
    return { thread: thread.id, changed }
  },
})

export const threadCommands: readonly CommandDefinition[] = [create, rename, appendContent, replaceContent]
