import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { addBlockTag, applyRemoteDay, createPropertyDefinition, createTag, db, markDaySynced, pruneOrphanThreads, removeBlockTag, saveDay, saveThreadNote, setBlockProperty, toggleTask, updateTagDefinition } from './db'

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

  it('cleans up existing orphan records and blank thread notes', async () => {
    const now = new Date().toISOString()
    await db.threads.put({ id: 'thi', title: 'thi', normalizedTitle: 'thi', createdAt: now, updatedAt: now })
    await db.threadNotes.put({ threadId: 'thi', markdown: '- ', blockCount: 1, updatedAt: now, localRevision: 1 })

    await pruneOrphanThreads()

    expect(await db.threads.get('thi')).toBeUndefined()
    expect(await db.threadNotes.get('thi')).toBeUndefined()
  })

  it('completes a nested task even when its saved line number is stale', async () => {
    await saveDay(DATE, '- Parent\n  1. [ ] Finish this by Monday')
    const task = (await db.tasks.where('day').equals(DATE).first())!
    expect(task.dueDate).toBe('2026-08-24')
    await toggleTask({ ...task, line: 99 })

    expect((await db.days.get(DATE))?.markdown).toContain('1. [x] Finish this by Monday')
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
