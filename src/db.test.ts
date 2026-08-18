import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, saveDay, saveThreadNote, toggleTask } from './db'

const DATE = '2026-08-19'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

afterAll(() => db.close())

describe('journal persistence', () => {
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

  it('completes a nested task even when its saved line number is stale', async () => {
    await saveDay(DATE, '- Parent\n  1. [ ] Finish this by Monday')
    const task = (await db.tasks.where('day').equals(DATE).first())!
    expect(task.dueDate).toBe('2026-08-24')
    await toggleTask({ ...task, line: 99 })

    expect((await db.days.get(DATE))?.markdown).toContain('1. [x] Finish this by Monday')
  })
})
