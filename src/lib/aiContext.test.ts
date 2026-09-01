import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createPropertyDefinition, createTag, createThread, db, saveDay, saveThreadNote, setThreadIsTemplate, setThreadProperty, type TaskRecord } from '../db'
import { buildThreadSystemContext, loadThreadAppContext, renderThreadAppContext, THREAD_FEATURE_GUIDE } from './aiContext'
import { getThreadScriptHelp } from './threadscript/help'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

afterAll(() => db.close())

describe('Thread AI context', () => {
  it('builds a bounded active-thread snapshot with templates, properties, tags, and task counts', async () => {
    const threadId = await createThread('Project Atlas')
    const longContent = `- Context\n${'detail '.repeat(400)}`
    await saveThreadNote(threadId, longContent)
    const priority = await createPropertyDefinition({ name: 'Client priority', type: 'text' })
    await setThreadProperty(threadId, priority.id, 'High')
    const templateId = await createThread('Weekly Review')
    await setThreadIsTemplate(templateId, true)
    await createTag('project')
    await db.tasks.put(task('task-1', 'blocked'))
    await db.tasks.put(task('task-2', 'done'))

    const context = await loadThreadAppContext(`/thread/${threadId}`)

    expect(context.activeView).toBe('thread')
    expect(context.activeThread).toMatchObject({
      id: threadId,
      title: 'Project Atlas',
      truncated: true,
      properties: [{ id: priority.id, name: 'Client priority', type: 'text', value: 'High' }],
    })
    expect(context.activeThread!.content.length).toBeLessThanOrEqual(context.limits.contentCharacters + 1)
    expect(context.resources.templates).toContainEqual({ id: templateId, title: 'Weekly Review' })
    expect(context.resources.tags).toContainEqual({ id: 'project', name: 'project' })
    expect(context.resources.taskCounts).toMatchObject({ blocked: 1, done: 1, not_started: 0 })
    expect(context.threadScript.availableCommandCount).toBe(13)
  })

  it('includes the selected journal date and never constructs credential fields', async () => {
    await saveDay('2026-09-01', '- Today context')
    const context = await loadThreadAppContext('/?date=2026-09-01')
    const rendered = renderThreadAppContext(context)

    expect(context.activeDay).toEqual({ date: '2026-09-01', content: '- Today context', truncated: false })
    expect(rendered).not.toMatch(/apiKey|github_pat|credential|token/i)
  })

  it('combines the stable feature guide with a fresh workspace snapshot', async () => {
    const threadId = await createThread('Context thread')
    const prompt = await buildThreadSystemContext(`/thread/${threadId}`)

    expect(THREAD_FEATURE_GUIDE).toContain('ThreadScript is the one-shot action language')
    expect(prompt).toContain('Current Thread workspace')
    expect(prompt).toContain('Context thread')
    expect(prompt).toContain('only a proposal')
  })
})

describe('ThreadScript capability help', () => {
  it('returns compact template-focused help with generated input and output schemas', () => {
    const help = getThreadScriptHelp('create and apply templates', { limit: 4 })

    expect(help.availableCommandCount).toBe(13)
    expect(help.commands.map((command) => command.name)).toEqual(expect.arrayContaining(['template.create', 'template.apply']))
    const create = help.commands.find((command) => command.name === 'template.create')!
    expect(create.example).toContain('action template.create')
    expect(create.inputSchema).toMatchObject({
      type: 'object',
      properties: { title: { type: 'string' } },
    })
    expect(create.outputSchema).toMatchObject({
      type: 'object',
      properties: { thread: { type: 'string' } },
    })
  })

  it('caps detailed help while retaining the complete compact category catalog', () => {
    const help = getThreadScriptHelp('', { limit: 2 })
    expect(help.commands).toHaveLength(2)
    expect(help.categories.flatMap((category) => category.commands)).toHaveLength(13)
  })
})

function task(id: string, status: TaskRecord['status']): TaskRecord {
  return {
    id,
    blockId: id,
    day: '2026-09-01',
    line: 0,
    order: 0,
    text: id,
    checked: status === 'done',
    status,
    statusSource: 'manual',
    completedSubtasks: 0,
    totalSubtasks: 0,
    updatedAt: new Date().toISOString(),
  }
}

