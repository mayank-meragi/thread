import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createPropertyDefinition, createThread, db, saveThreadNote, setThreadIsTemplate, setThreadProperty } from '../../db'
import { createPersona } from '../personas'
import { parseThreadDocument } from '../threadDocument'
import { commandRegistry, projectCommandOutput, type PendingEntityIndex } from './index'
import { CommandRegistry } from './registry'
import { resolveThread } from './resolve'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

afterAll(() => db.close())

describe('command registry', () => {
  it('registers the complete first-slice vocabulary with compact metadata', () => {
    expect(commandRegistry.list().map((command) => command.name)).toEqual([
      'journal.takeNote',
      'property.assign',
      'property.create',
      'property.remove',
      'property.set',
      'template.apply',
      'template.create',
      'template.disable',
      'template.enable',
      'thread.content.append',
      'thread.content.replace',
      'thread.create',
      'thread.rename',
    ])
    expect(commandRegistry.require('thread.content.replace')).toMatchObject({ risk: 'destructive', idempotency: 'natural' })
    expect(commandRegistry.require('journal.takeNote')).toMatchObject({ risk: 'write', idempotency: 'receipt-required' })
  })

  it('rejects unknown and duplicate commands', () => {
    expect(() => commandRegistry.require('thread.missing')).toThrow('Unknown command thread.missing')
    const command = commandRegistry.require('thread.create')
    expect(() => new CommandRegistry().register(command).register(command)).toThrow('already registered')
  })

  it('prepares a thread creation without writing, then executes through the registry', async () => {
    const prepared = await commandRegistry.prepare('thread.create', { title: 'Project Atlas' })

    expect(await db.threads.count()).toBe(0)
    expect(prepared.preview).toMatchObject({
      summary: 'Create thread “Project Atlas”',
      changes: [{ kind: 'create', after: { title: 'Project Atlas' } }],
    })

    await expect(commandRegistry.execute(prepared, { idempotencyKey: 'proposal-1:0' })).resolves.toEqual({
      thread: 'project-atlas',
      created: true,
    })
    expect(await db.threads.get('project-atlas')).toMatchObject({ title: 'Project Atlas' })
  })

  it('does not append thread content during preparation', async () => {
    const threadId = await createThread('Project Atlas')
    await saveThreadNote(threadId, '- Existing')

    const prepared = await commandRegistry.prepare('thread.content.append', {
      thread: threadId,
      content: '- Next step',
    })

    expect(parseThreadDocument((await db.threadNotes.get(threadId))!.markdown).markdown).toBe('- Existing')
    expect(prepared.preview.changes[0]).toMatchObject({
      kind: 'append',
      before: '- Existing',
      after: '- Existing\n\n- Next step',
    })

    await commandRegistry.execute(prepared, { idempotencyKey: 'proposal-2:0' })
    expect(parseThreadDocument((await db.threadNotes.get(threadId))!.markdown).markdown).toBe('- Existing\n\n- Next step')
  })

  it('creates a template with validated existing properties only after execution', async () => {
    const status = await createPropertyDefinition({ name: 'Review status', type: 'text' })
    const prepared = await commandRegistry.prepare('template.create', {
      title: 'Weekly Review',
      content: '- Wins\n- Challenges',
      properties: { 'Review status': 'Not started' },
    })

    expect(await db.threads.get('weekly-review')).toBeUndefined()
    expect(prepared.preview.changes).toHaveLength(2)

    await expect(commandRegistry.execute(prepared, { idempotencyKey: 'proposal-3:0' })).resolves.toEqual({
      thread: 'weekly-review',
      created: true,
    })
    expect(await db.threads.get('weekly-review')).toMatchObject({ isTemplate: true })
    expect(await db.threadProperties.get(`weekly-review:${status.id}`)).toMatchObject({ value: 'Not started' })
  })

  it('validates property values before producing an executable preview', async () => {
    const threadId = await createThread('Estimate test')
    await createPropertyDefinition({ name: 'Effort', type: 'number' })

    await expect(commandRegistry.prepare('property.set', {
      thread: threadId,
      property: 'Effort',
      value: 'large',
    })).rejects.toThrow('Effort must be a number')
    expect(await db.threadProperties.count()).toBe(0)
  })

  it('previews and applies a template without clobbering explicit properties', async () => {
    const owner = await createPropertyDefinition({ name: 'Owner', type: 'text' })
    const templateId = await createThread('Handoff')
    await setThreadIsTemplate(templateId, true)
    await saveThreadNote(templateId, '- Checklist')
    await setThreadProperty(templateId, owner.id, 'Template owner')
    const targetId = await createThread('Project Z')
    await saveThreadNote(targetId, '- Existing')
    await setThreadProperty(targetId, owner.id, 'Mayank')

    const prepared = await commandRegistry.prepare('template.apply', { template: templateId, thread: targetId })

    expect(prepared.preview.changes).toHaveLength(1)
    expect(prepared.preview.changes[0]).toMatchObject({ kind: 'append', field: 'content' })
    await commandRegistry.execute(prepared, { idempotencyKey: 'proposal-4:0' })
    expect(parseThreadDocument((await db.threadNotes.get(targetId))!.markdown).markdown).toContain('- Checklist')
    expect(await db.threadProperties.get(`${targetId}:${owner.id}`)).toMatchObject({ value: 'Mayank' })
  })

  it('projects a create command output that matches what execution later returns', async () => {
    const prepared = await commandRegistry.prepare('thread.create', { title: 'Project Atlas' })
    expect(projectCommandOutput(prepared)).toEqual({ thread: 'project-atlas', created: true })

    const executed = await commandRegistry.execute(prepared, { idempotencyKey: 'p:0' })
    expect(executed).toEqual(projectCommandOutput(prepared))
  })

  it('projects an existing-thread create as created: false', async () => {
    const id = await createThread('Project Atlas')
    const prepared = await commandRegistry.prepare('thread.create', { title: 'Project Atlas' })
    expect(projectCommandOutput(prepared)).toEqual({ thread: id, created: false })
  })

  it('resolves a pending entity only when the plan index carries it', async () => {
    const pendingEntities: PendingEntityIndex = {
      threads: new Map([['Weekly Review', { id: 'weekly-review', title: 'Weekly Review', isTemplate: true }]]),
      properties: new Map(),
    }
    const stub = await resolveThread('Weekly Review', undefined, { pendingEntities })
    expect(stub).toMatchObject({ id: 'weekly-review', isTemplate: true, updatedAt: '' })

    await expect(resolveThread('Weekly Review')).rejects.toThrow(/not found/i)
  })

  it('previews property.set against a thread an earlier step will create', async () => {
    await createPropertyDefinition({ name: 'Cadence', type: 'text' })
    const pendingEntities: PendingEntityIndex = {
      threads: new Map([['weekly-review', { id: 'weekly-review', title: 'Weekly Review' }]]),
      properties: new Map(),
    }
    const prepared = await commandRegistry.prepare(
      'property.set',
      { thread: 'weekly-review', property: 'Cadence', value: 'Weekly' },
      { pendingEntities },
    )
    expect(prepared.preview.changes[0]).toMatchObject({ field: 'Cadence', after: 'Weekly' })
    expect(await db.threadProperties.count()).toBe(0)
  })

  it('keeps journal note preparation read-only and resolves the current persona from context', async () => {
    const persona = await createPersona({ name: 'Coach', icon: 'sparkles', systemPrompt: 'Be direct.' })

    const prepared = await commandRegistry.prepare('journal.takeNote', {
      persona: 'current',
      note: 'Prefers short check-ins.',
    }, { activePersonaId: persona.id })

    expect(await db.days.count()).toBe(0)
    expect(prepared.preview.changes[0]).toMatchObject({
      kind: 'append',
      after: 'Prefers short check-ins.',
    })

    await commandRegistry.execute(prepared, { idempotencyKey: 'proposal-5:0' })
    const day = await db.days.toCollection().first()
    expect(day?.markdown).toContain('[[Coach]]')
    expect(day?.markdown).toContain('Prefers short check-ins.')
  })
})

