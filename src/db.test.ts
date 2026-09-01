import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { addBlockTag, applyRemoteDay, applyThreadTemplate, createPropertyDefinition, createTag, createThread, db, deleteTagDefinition, ensureThreadNote, initializeDatabase, markDaySynced, pruneOrphanThreads, removeBlockTag, removeThreadProperty, renameThread, saveDay, saveThreadNote, setBlockProperty, setThreadIsTemplate, setThreadProperty, toggleTask, updateTagDefinition } from './db'
import { parseThreadDocument } from './lib/threadDocument'
import { WORKOUT_SYSTEM_TAGS } from './lib/workouts/systemTags'

const DATE = '2026-08-19'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

afterAll(() => db.close())

describe('journal persistence', () => {
  it('preserves stable block identities across moves and edits', async () => {
    await saveDay(DATE, '- Alpha\n- Beta')
    const first = await db.blocks.where('day').equals(DATE).sortBy('order')
    const alphaId = first[0].id
    const betaId = first[1].id

    await saveDay(DATE, '- Beta\n- Alpha')
    const moved = await db.blocks.where('day').equals(DATE).sortBy('order')
    expect(moved.map((block) => block.id)).toEqual([betaId, alphaId])

    await saveDay(DATE, '- Beta\n- Alpha revised')
    const edited = await db.blocks.where('day').equals(DATE).sortBy('order')
    expect(edited[1].id).toBe(alphaId)
  })

  it('persists typed block properties and tags in the day metadata projection', async () => {
    await saveDay(DATE, '- A block with context')
    const block = (await db.blocks.where('day').equals(DATE).first())!
    const property = await createPropertyDefinition({ name: 'Effort', type: 'number' })
    const tag = await createTag('project')

    await setBlockProperty(block.id, property.id, 3)
    await addBlockTag(block.id, tag.id)

    expect(await db.blockProperties.get(`${block.id}:${property.id}`)).toMatchObject({ value: 3, source: 'explicit' })
    expect(await db.blockTags.get(`${block.id}:${tag.id}`)).toMatchObject({ tagId: tag.id })
    expect((await db.days.get(DATE))?.metadata?.blocks[block.id]).toMatchObject({
      properties: { [property.id]: 3 },
      tags: [tag.id],
    })
    expect(await db.outbox.get(`day:${DATE}`)).toBeDefined()
  })

  it('creates and synchronizes tags typed with hashtag syntax', async () => {
    await saveDay(DATE, '- Plan the launch #project')
    expect(await db.tagDefinitions.count()).toBe(0)

    await saveDay(DATE, '- Plan the launch #[project]')
    let block = (await db.blocks.where('day').equals(DATE).first())!
    const project = (await db.tagDefinitions.where('name').equals('project').first())!

    expect(await db.blockTags.get(`${block.id}:${project.id}`)).toMatchObject({ source: 'inline' })

    await saveDay(DATE, '- Plan the launch')
    block = (await db.blocks.where('day').equals(DATE).first())!
    expect(await db.blockTags.get(`${block.id}:${project.id}`)).toBeUndefined()
  })

  it('applies schema defaults through a typed hashtag', async () => {
    const stage = await createPropertyDefinition({ name: 'Stage', type: 'text' })
    const project = await createTag('project')
    await updateTagDefinition(project.id, { propertyIds: [stage.id], propertyDefaults: { [stage.id]: 'Planning' } })

    await saveDay(DATE, '- Shape the brief #[project]')
    const block = (await db.blocks.where('day').equals(DATE).first())!

    expect(await db.blockProperties.get(`${block.id}:${stage.id}`)).toMatchObject({
      value: 'Planning',
      source: 'automation',
      sourceTagId: project.id,
    })
  })

  it('keeps an explicitly applied tag after its hashtag text is removed', async () => {
    await saveDay(DATE, '- Durable association #[project]')
    let block = (await db.blocks.where('day').equals(DATE).first())!
    const project = (await db.tagDefinitions.where('name').equals('project').first())!
    await addBlockTag(block.id, project.id)

    await saveDay(DATE, '- Durable association')
    block = (await db.blocks.where('day').equals(DATE).first())!

    expect(await db.blockTags.get(`${block.id}:${project.id}`)).toMatchObject({ source: 'explicit' })
  })

  it('applies schema defaults when a tag is added to a block', async () => {
    await saveDay(DATE, '- A project block')
    const block = (await db.blocks.where('day').equals(DATE).first())!
    const stage = await createPropertyDefinition({ name: 'Stage', type: 'text' })
    const project = await createTag('project')
    await updateTagDefinition(project.id, {
      propertyIds: [stage.id],
      propertyDefaults: { [stage.id]: 'Planning' },
      requiredPropertyIds: [stage.id],
    })

    await addBlockTag(block.id, project.id)

    expect(await db.blockProperties.get(`${block.id}:${stage.id}`)).toMatchObject({
      value: 'Planning',
      source: 'automation',
      sourceTagId: project.id,
    })
  })

  it('backfills existing tag applications and preserves explicit overrides', async () => {
    await saveDay(DATE, '- Existing tagged block')
    const block = (await db.blocks.where('day').equals(DATE).first())!
    const stage = await createPropertyDefinition({ name: 'Stage', type: 'text' })
    const project = await createTag('project')
    await addBlockTag(block.id, project.id)

    await updateTagDefinition(project.id, { propertyIds: [stage.id], propertyDefaults: { [stage.id]: 'Planning' } })
    expect(await db.blockProperties.get(`${block.id}:${stage.id}`)).toMatchObject({ value: 'Planning', source: 'automation' })

    await setBlockProperty(block.id, stage.id, 'Shipping')
    await updateTagDefinition(project.id, { propertyIds: [stage.id], propertyDefaults: { [stage.id]: 'Done' } })
    await removeBlockTag(block.id, project.id)

    expect(await db.blockProperties.get(`${block.id}:${stage.id}`)).toMatchObject({ value: 'Shipping', source: 'explicit' })
  })

  it('removes schema-owned defaults when a field leaves the schema', async () => {
    await saveDay(DATE, '- Disposable default')
    const block = (await db.blocks.where('day').equals(DATE).first())!
    const effort = await createPropertyDefinition({ name: 'Effort', type: 'number' })
    const project = await createTag('project')
    await updateTagDefinition(project.id, { propertyIds: [effort.id], propertyDefaults: { [effort.id]: 3 } })
    await addBlockTag(block.id, project.id)

    await updateTagDefinition(project.id, { propertyIds: [], propertyDefaults: {} })

    expect(await db.blockProperties.get(`${block.id}:${effort.id}`)).toBeUndefined()
  })

  it('archives the previous value before replacing a day', async () => {
    await saveDay(DATE, '- original note')
    await saveDay(DATE, '- changed note')

    expect((await db.days.get(DATE))?.markdown).toBe('- changed note')
    expect((await db.revisions.get(`${DATE}:1`))?.markdown).toBe('- original note')
  })

  it('serializes rapid writes so an older save cannot finish last', async () => {
    await saveDay(DATE, '- starting value')

    await Promise.all([
      saveDay(DATE, '- first edit'),
      saveDay(DATE, '- second edit'),
      saveDay(DATE, '- final edit'),
    ])

    expect((await db.days.get(DATE))?.markdown).toBe('- final edit')
    expect(await db.revisions.where('day').equals(DATE).count()).toBe(3)
  })

  it('keeps a recoverable revision even when content becomes empty', async () => {
    await saveDay(DATE, '- irreplaceable note')
    await saveDay(DATE, '- ')

    const revisions = await db.revisions.where('day').equals(DATE).toArray()
    expect(revisions.map((revision) => revision.markdown)).toContain('- irreplaceable note')
  })

  it('stores thread notes separately without creating or changing a dated note', async () => {
    await saveDay(DATE, '- journal note')
    await saveThreadNote('browser', '- private thread note')

    expect((await db.days.get(DATE))?.markdown).toBe('- journal note')
    expect((await db.threadNotes.get('browser'))?.markdown).toBe('- private thread note')
    expect((await db.days.toArray()).some((day) => day.markdown === '- private thread note')).toBe(false)
    expect(await db.outbox.get('thread-note:browser')).toMatchObject({
      kind: 'thread-note',
      aggregateId: 'browser',
    })
  })

  it('does not index an unfinished wikilink draft', async () => {
    await saveDay(DATE, '- Discuss [[Brows')

    expect(await db.threads.count()).toBe(0)
    expect(await db.mentions.count()).toBe(0)
  })

  it('removes an automatic thread after its final mention is corrected', async () => {
    await saveDay(DATE, '- Discuss [[Brower]]')
    await saveDay(DATE, '- Discuss [[Browser]]')

    expect(await db.threads.get('brower')).toBeUndefined()
    expect(await db.threads.get('browser')).toMatchObject({ title: 'Browser' })
  })

  it('preserves an unmentioned thread when it has meaningful thread-only notes', async () => {
    await saveDay(DATE, '- Discuss [[Browser]]')
    await saveThreadNote('browser', '- Keep this thread note')
    await saveDay(DATE, '- Link removed')
    await pruneOrphanThreads()

    expect(await db.threads.get('browser')).toBeDefined()
  })

  it('keeps a directly-created thread even while it is empty', async () => {
    const id = await createThread('Redesign onboarding')
    expect(id).toBe('redesign-onboarding')

    await pruneOrphanThreads()

    expect(await db.threads.get('redesign-onboarding')).toMatchObject({
      title: 'Redesign onboarding',
      origin: 'manual',
    })
  })

  it('createThread returns the existing thread on a slug collision without clobbering it', async () => {
    await saveDay(DATE, '- Discuss [[Browser]]')
    const existing = await db.threads.get('browser')

    const id = await createThread('browser')

    expect(id).toBe('browser')
    expect(await db.threads.get('browser')).toMatchObject({
      title: 'Browser',
      createdAt: existing!.createdAt,
    })
  })

  it('cleans up existing orphan records and blank thread notes', async () => {
    const now = new Date().toISOString()
    await db.threads.put({ id: 'thi', title: 'thi', normalizedTitle: 'thi', createdAt: now, updatedAt: now })
    await db.threadNotes.put({ threadId: 'thi', markdown: '- ', blockCount: 1, updatedAt: now, localRevision: 1 })

    await pruneOrphanThreads()

    expect(await db.threads.get('thi')).toBeUndefined()
    expect(await db.threadNotes.get('thi')).toBeUndefined()
  })

  it('stores thread properties in the note envelope and the threadProperties index', async () => {
    await createThread('Browser')
    await setThreadProperty('browser', 'priority', 'high')
    await setThreadProperty('browser', 'estimate-minutes', 90)

    const note = await db.threadNotes.get('browser')
    expect(note!.markdown.startsWith('<!-- thread-metadata')).toBe(true)
    expect(note!.metadata!.properties).toEqual({ priority: 'high', 'estimate-minutes': 90 })
    const rows = await db.threadProperties.where('threadId').equals('browser').toArray()
    expect(rows.map((row) => [row.propertyId, row.value]).sort()).toEqual([
      ['estimate-minutes', 90],
      ['priority', 'high'],
    ])
  })

  it('editing the thread note body preserves its properties', async () => {
    await createThread('Browser')
    await setThreadProperty('browser', 'priority', 'high')

    await saveThreadNote('browser', '- a fresh line of prose')

    const note = await db.threadNotes.get('browser')
    expect(note!.metadata!.properties).toEqual({ priority: 'high' })
    expect(note!.markdown).toContain('- a fresh line of prose')
  })

  it('removing the last thread property drops the envelope entirely', async () => {
    await createThread('Browser')
    await ensureThreadNote('browser')
    await setThreadProperty('browser', 'priority', 'high')
    await removeThreadProperty('browser', 'priority')

    const note = await db.threadNotes.get('browser')
    expect(note!.markdown.startsWith('<!-- thread-metadata')).toBe(false)
    expect(note!.metadata!.properties).toEqual({})
    expect(await db.threadProperties.where('threadId').equals('browser').count()).toBe(0)
  })

  it('completes a nested task even when its saved line number is stale', async () => {
    await saveDay(DATE, '- Parent\n  1. [ ] Finish this by Monday')
    const task = (await db.tasks.where('day').equals(DATE).first())!
    expect(task.dueDate).toBe('2026-08-24')
    await toggleTask({ ...task, line: 99 })

    expect((await db.days.get(DATE))?.markdown).toContain('1. [x] Finish this by Monday')
  })
})

describe('workout system metadata', () => {
  it('seeds stable workout tags and their property schemas idempotently', async () => {
    await initializeDatabase(DATE)
    await initializeDatabase(DATE)

    expect(await db.tagDefinitions.get(WORKOUT_SYSTEM_TAGS.workout)).toMatchObject({
      name: 'workout',
      propertyIds: ['workout-started-at', 'workout-finished-at'],
    })
    expect(await db.tagDefinitions.get(WORKOUT_SYSTEM_TAGS.exercise)).toMatchObject({
      name: 'exercise',
      propertyIds: [],
    })
    expect(await db.tagDefinitions.get(WORKOUT_SYSTEM_TAGS.set)).toMatchObject({
      name: 'set',
      propertyIds: [
        'set-load',
        'set-load-unit',
        'set-reps',
        'set-rpe',
        'set-duration-seconds',
        'set-distance',
        'set-distance-unit',
      ],
    })
    expect(await db.tagDefinitions.where('id').anyOf(Object.values(WORKOUT_SYSTEM_TAGS)).count()).toBe(3)
    expect(await db.propertyDefinitions.get('set-load-unit')).toMatchObject({
      type: 'select',
      options: [{ id: 'kg', label: 'kg' }, { id: 'lb', label: 'lb' }],
    })
  })

  it('keeps a colliding ordinary tag but resolves reserved inline syntax to the system tag', async () => {
    const ordinary = await createTag('workout')
    expect(ordinary.id).toBe('workout')

    await initializeDatabase(DATE)
    await saveDay(DATE, '- [ ] #[workout] [[Push Day]]')

    const block = (await db.blocks.where('day').equals(DATE).first())!
    expect(await db.tagDefinitions.get(ordinary.id)).toBeDefined()
    expect(await db.blockTags.get(`${block.id}:${WORKOUT_SYSTEM_TAGS.workout}`)).toMatchObject({ source: 'inline' })
    expect(await db.blockTags.get(`${block.id}:${ordinary.id}`)).toBeUndefined()
  })

  it('protects system tags from deletion and renaming', async () => {
    await initializeDatabase(DATE)

    await expect(deleteTagDefinition(WORKOUT_SYSTEM_TAGS.set)).rejects.toThrow('cannot be deleted')
    await expect(updateTagDefinition(WORKOUT_SYSTEM_TAGS.set, { name: 'working-set' })).rejects.toThrow('cannot be renamed')

    expect(await db.tagDefinitions.get(WORKOUT_SYSTEM_TAGS.set)).toMatchObject({ name: 'set' })
  })

  it('allows only one structural workout tag on a block', async () => {
    await initializeDatabase(DATE)
    await saveDay(DATE, '- [ ] A semantic task')
    const block = (await db.blocks.where('day').equals(DATE).first())!

    await addBlockTag(block.id, WORKOUT_SYSTEM_TAGS.exercise)
    await addBlockTag(block.id, WORKOUT_SYSTEM_TAGS.set)

    const tags = await db.blockTags.where('blockId').equals(block.id).toArray()
    expect(tags.map((tag) => tag.tagId)).toEqual([WORKOUT_SYSTEM_TAGS.set])
  })

  it('converts a plain block into a task when a structural tag is applied', async () => {
    await initializeDatabase(DATE)
    await saveDay(DATE, '- Bench Press')
    const block = (await db.blocks.where('day').equals(DATE).first())!

    await addBlockTag(block.id, WORKOUT_SYSTEM_TAGS.exercise)

    expect((await db.days.get(DATE))?.markdown).toBe('- [ ] Bench Press')
    expect(await db.tasks.get(block.id)).toBeDefined()
    expect(await db.blockTags.get(`${block.id}:${WORKOUT_SYSTEM_TAGS.exercise}`)).toBeDefined()
  })

  it('lets the last inline structural role replace an explicitly applied role', async () => {
    await initializeDatabase(DATE)
    await saveDay(DATE, '- [ ] Semantic task')
    const block = (await db.blocks.where('day').equals(DATE).first())!
    await addBlockTag(block.id, WORKOUT_SYSTEM_TAGS.workout)

    await saveDay(DATE, '- [ ] #[exercise] Semantic task')

    const tags = await db.blockTags.where('blockId').equals(block.id).toArray()
    expect(tags.map((tag) => tag.tagId)).toEqual([WORKOUT_SYSTEM_TAGS.exercise])
  })
})

describe('sync races', () => {
  it('keeps a day queued for sync if a newer edit landed while its push was in flight', async () => {
    await saveDay(DATE, '- This is sy')
    const pushedRevision = (await db.days.get(DATE))!.localRevision

    // The push for `pushedRevision` is still in flight (e.g. a slow network
    // request) when the user finishes typing and this newer edit lands.
    await saveDay(DATE, '- This is sync test')

    // The in-flight push for the earlier, now-stale revision finally
    // resolves and reports success.
    await markDaySynced(DATE, 'remote-sha-for-stale-push', pushedRevision, '- This is sy')

    // The newer content must not be silently dropped from the sync queue --
    // it was never actually pushed to the remote.
    expect(await db.outbox.get(`day:${DATE}`)).toBeDefined()
    expect((await db.days.get(DATE))?.markdown).toBe('- This is sync test')
    expect((await db.days.get(DATE))?.remoteSha).toBe('remote-sha-for-stale-push')
  })

  it('clears the queued sync entry once the synced revision is current', async () => {
    await saveDay(DATE, '- only version')
    const revision = (await db.days.get(DATE))!.localRevision

    await markDaySynced(DATE, 'remote-sha', revision, '- only version')

    expect(await db.outbox.get(`day:${DATE}`)).toBeUndefined()
  })

  it('applies a pulled remote day locally without re-queuing it for sync', async () => {
    await applyRemoteDay(DATE, '- written on another device', 'remote-sha')

    expect((await db.days.get(DATE))?.markdown).toBe('- written on another device')
    expect((await db.days.get(DATE))?.remoteSha).toBe('remote-sha')
    expect(await db.outbox.get(`day:${DATE}`)).toBeUndefined()
  })
})

describe('renameThread', () => {
  it('updates the title without changing the slug or touching notes/properties', async () => {
    const id = await createThread('Old Name')
    const property = await createPropertyDefinition({ name: 'Status', type: 'text' })
    await setThreadProperty(id, property.id, 'active')
    await saveThreadNote(id, '- keep this body')

    await renameThread(id, '  New Name  ')

    const thread = await db.threads.get(id)
    expect(thread?.id).toBe(id)
    expect(thread?.title).toBe('New Name')
    expect(thread?.normalizedTitle).toBe('new name')
    expect(parseThreadDocument((await db.threadNotes.get(id))!.markdown).markdown).toContain('keep this body')
    expect(await db.threadProperties.get(`${id}:${property.id}`)).toMatchObject({ value: 'active' })
  })

  it('refreshes the denormalised title on mentions and occurrences', async () => {
    const id = await createThread('Alpha')
    await db.mentions.put({ id: 'm1', threadId: id, title: 'Alpha', day: DATE, line: 0, blockId: 'b1', excerpt: 'x', kind: 'thought', checked: false })
    await db.occurrences.put({ id: 'o1', threadId: id, title: 'Alpha', day: DATE, rootBlockId: 'b1', order: 0 })

    await renameThread(id, 'Beta')

    expect((await db.mentions.get('m1'))?.title).toBe('Beta')
    expect((await db.occurrences.get('o1'))?.title).toBe('Beta')
  })

  it('rejects an empty title and no-ops when unchanged', async () => {
    const id = await createThread('Same')
    await expect(renameThread(id, '   ')).rejects.toThrow()
    const before = await db.threads.get(id)
    await renameThread(id, 'Same')
    expect((await db.threads.get(id))?.updatedAt).toBe(before?.updatedAt)
  })
})

describe('per-thread property assignment', () => {
  it('assigns a blank property to one thread only, and removes it cleanly', async () => {
    const a = await createThread('Thread A')
    const b = await createThread('Thread B')
    const property = await createPropertyDefinition({ name: 'Priority', type: 'text' })

    // Assigning with a null value keeps the property attached but blank.
    await setThreadProperty(a, property.id, null)

    expect(await db.threadProperties.get(`${a}:${property.id}`)).toMatchObject({ value: null })
    expect(await db.threadProperties.where('threadId').equals(b).count()).toBe(0)

    // A later value edit updates the same assignment in place.
    await setThreadProperty(a, property.id, 'high')
    expect(await db.threadProperties.get(`${a}:${property.id}`)).toMatchObject({ value: 'high' })

    await removeThreadProperty(a, property.id)
    expect(await db.threadProperties.get(`${a}:${property.id}`)).toBeUndefined()
  })
})

describe('thread templates', () => {
  it('toggles isTemplate and keeps a marked thread from being pruned as an orphan', async () => {
    // A thread discovered from journal text (no `origin: 'manual'`), so only
    // the isTemplate flag can save it from the orphan sweep.
    const now = new Date().toISOString()
    await db.threads.put({ id: 'weekly-review', title: 'Weekly Review', normalizedTitle: 'weekly review', createdAt: now, updatedAt: now })
    await ensureThreadNote('weekly-review')

    await setThreadIsTemplate('weekly-review', true)
    expect((await db.threads.get('weekly-review'))?.isTemplate).toBe(true)

    await pruneOrphanThreads()
    expect(await db.threads.get('weekly-review')).toBeDefined()

    await setThreadIsTemplate('weekly-review', false)
    expect((await db.threads.get('weekly-review'))?.isTemplate).toBeUndefined()
    await pruneOrphanThreads()
    expect(await db.threads.get('weekly-review')).toBeUndefined()
  })

  it('replaces an empty thread body and copies the template thread properties', async () => {
    const templateId = await createThread('Kickoff template')
    await setThreadIsTemplate(templateId, true)
    const property = await createPropertyDefinition({ name: 'Stage', type: 'text' })
    await saveThreadNote(templateId, '- [ ] Define scope\n- Context: ')
    await setThreadProperty(templateId, property.id, 'planning')

    const threadId = await createThread('Project X')
    await applyThreadTemplate(threadId, templateId)

    const body = parseThreadDocument((await db.threadNotes.get(threadId))!.markdown).markdown
    expect(body.startsWith('- [ ] Define scope')).toBe(true)
    expect(await db.threadProperties.get(`${threadId}:${property.id}`)).toMatchObject({ value: 'planning' })
  })

  it('appends to a non-empty body and never clobbers an explicit property', async () => {
    const property = await createPropertyDefinition({ name: 'Owner', type: 'text' })

    const templateId = await createThread('Handoff template')
    await setThreadIsTemplate(templateId, true)
    await saveThreadNote(templateId, '- Handoff checklist')
    await setThreadProperty(templateId, property.id, 'someone-else')

    const threadId = await createThread('Project Y')
    await saveThreadNote(threadId, '- existing note')
    await setThreadProperty(threadId, property.id, 'me')

    await applyThreadTemplate(threadId, templateId)

    const body = parseThreadDocument((await db.threadNotes.get(threadId))!.markdown).markdown
    expect(body).toContain('existing note')
    expect(body).toContain('Handoff checklist')
    expect(await db.threadProperties.get(`${threadId}:${property.id}`)).toMatchObject({ value: 'me' })
  })
})
