import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createPropertyDefinition, createThread, db, saveThreadNote } from '../../db'
import { compileThreadScript } from './compiler'
import { resolvePlan } from './plan'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

afterAll(() => db.close())

async function snapshot() {
  return JSON.stringify([
    await db.threads.toArray(),
    await db.threadNotes.toArray(),
    await db.propertyDefinitions.toArray(),
    await db.threadProperties.toArray(),
  ])
}

describe('resolvePlan', () => {
  it('threads a created entity into a later step and previews it for real', async () => {
    await createPropertyDefinition({ name: 'Cadence', type: 'text' })
    const before = await snapshot()

    const compiled = compileThreadScript(`plan "Weekly review"

action template.create as weekly
  title: "Weekly Review"
  content: "- Wins\\n- Challenges"
  properties:
    Cadence: "Weekly"

action property.set
  thread: $weekly.thread
  property: Cadence
  value: "Biweekly"
`)
    const resolved = await resolvePlan(compiled)

    expect(resolved.preview.steps).toHaveLength(2)
    expect(resolved.preview.steps[0].status).toBe('resolved')
    expect(resolved.preview.steps[1].status).toBe('resolved')
    expect(resolved.preview.steps[1].preview.changes[0]).toMatchObject({ field: 'Cadence', after: 'Biweekly' })
    expect(resolved.capturedTargets.find((target) => target.actionIndex === 1)).toMatchObject({
      ref: 'template:weekly-review',
      exists: false,
    })
    expect(await snapshot()).toBe(before)
  })

  it('falls back to a synthetic preview when a referenced step cannot resolve', async () => {
    // Two definitions share the name -- resolving "Cadence" is ambiguous.
    await createPropertyDefinition({ name: 'Cadence', type: 'text' })
    await createPropertyDefinition({ name: 'Cadence', type: 'text' })

    const compiled = compileThreadScript(`action thread.create as t
  title: "Atlas"

action property.set
  thread: $t.thread
  property: Cadence
  value: "Weekly"
`)
    const resolved = await resolvePlan(compiled)

    expect(resolved.preview.steps[0].status).toBe('resolved')
    expect(resolved.preview.steps[1].status).toBe('deferred')
    expect(resolved.preview.steps[1].preview.warnings).toContain('Full preview available after the referenced action runs.')
    expect(resolved.preview.warnings).toContain('Some steps are previewed from projected results and re-checked on confirm.')
    expect(resolved.prepared[1]).toBeNull()
  })

  it('rejects the whole plan when a non-referenced argument is ambiguous', async () => {
    await createPropertyDefinition({ name: 'Cadence', type: 'text' })
    await createPropertyDefinition({ name: 'Cadence', type: 'text' })
    await createThread('Atlas')

    const compiled = compileThreadScript(`action property.set
  thread: "Atlas"
  property: Cadence
  value: "Weekly"
`)
    await expect(resolvePlan(compiled)).rejects.toThrow(/ambiguous/i)
  })

  it('captures a thread-note revision for content steps', async () => {
    const id = await createThread('Atlas')
    await saveThreadNote(id, '- Existing')
    const note = await db.threadNotes.get(id)

    const compiled = compileThreadScript(`action thread.content.append
  thread: "Atlas"
  content: "- More"
`)
    const resolved = await resolvePlan(compiled)

    expect(resolved.expectedVersions['thread:atlas']).toBeDefined()
    expect(resolved.expectedVersions['threadNote:atlas']).toBe(note!.localRevision)
  })
})
