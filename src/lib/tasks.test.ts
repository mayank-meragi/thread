import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, saveDay } from '../db'
import { createSubtask, createTask, deleteTask, setTaskDescription, setTaskStatus, updateTaskTitle } from './tasks'

const DATE = '2026-08-22'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

afterAll(() => db.close())

describe('rich tasks', () => {
  it('derives hierarchy and leaf progress from nested tasks', async () => {
    await saveDay(DATE, '- [ ] Parent\n  - [x] First\n  - [ ] Second')
    const tasks = await db.tasks.where('day').equals(DATE).sortBy('order')

    expect(tasks[1].parentTaskId).toBe(tasks[0].id)
    expect(tasks[2].parentTaskId).toBe(tasks[0].id)
    expect(tasks[0]).toMatchObject({ status: 'in_progress', statusSource: 'derived', completedSubtasks: 1, totalSubtasks: 2, progress: .5 })
  })

  it('automatically completes and reopens derived parent tasks', async () => {
    await saveDay(DATE, '- [ ] Parent\n  - [ ] First\n  - [ ] Second')
    let tasks = await db.tasks.where('day').equals(DATE).sortBy('order')
    const parentId = tasks[0].id
    const firstId = tasks[1].id
    const secondId = tasks[2].id

    await setTaskStatus(firstId, 'done')
    expect(await db.tasks.get(parentId)).toMatchObject({ status: 'in_progress', completedSubtasks: 1, totalSubtasks: 2 })

    await setTaskStatus(secondId, 'done')
    expect(await db.tasks.get(parentId)).toMatchObject({ status: 'done', checked: true, statusSource: 'derived' })

    await setTaskStatus(firstId, 'not_started')
    expect(await db.tasks.get(parentId)).toMatchObject({ status: 'in_progress', checked: false, statusSource: 'derived' })
    expect((await db.days.get(DATE))?.markdown.split('\n')[0]).toContain('[ ] Parent')

    tasks = await db.tasks.where('day').equals(DATE).sortBy('order')
    expect(tasks.map((task) => task.id)).toEqual([parentId, firstId, secondId])
  })

  it('creates and edits tasks through their journal source', async () => {
    await saveDay(DATE, '- Existing note')
    const taskId = await createTask({ text: 'Ship it', day: DATE, dueDate: '2026-08-25', priority: 'high' })
    await setTaskDescription(taskId, 'Coordinate the release.')
    await updateTaskTitle(taskId, 'Ship the release')
    const subtaskId = await createSubtask(taskId, 'Run final checks')

    expect(await db.tasks.get(taskId)).toMatchObject({
      text: 'Ship the release',
      description: 'Coordinate the release.',
      dueDate: '2026-08-25',
      priority: 'high',
      totalSubtasks: 1,
    })
    expect(await db.tasks.get(subtaskId)).toMatchObject({ parentTaskId: taskId, text: 'Run final checks' })
    expect((await db.days.get(DATE))?.markdown).toContain('  - [ ] Run final checks')
  })

  it('supports middle and blocked states without checking Markdown', async () => {
    await saveDay(DATE, '- [ ] Investigate')
    const task = (await db.tasks.where('day').equals(DATE).first())!

    await setTaskStatus(task.id, 'in_progress')
    expect(await db.tasks.get(task.id)).toMatchObject({ status: 'in_progress', checked: false })
    await setTaskStatus(task.id, 'blocked')
    expect(await db.tasks.get(task.id)).toMatchObject({ status: 'blocked', checked: false })
    expect((await db.days.get(DATE))?.markdown).toContain('[ ] Investigate')
  })

  it('recomputes a parent after deleting a subtask', async () => {
    await saveDay(DATE, '- [ ] Parent\n  - [x] Finished\n  - [ ] Remove me')
    const tasks = await db.tasks.where('day').equals(DATE).sortBy('order')

    await deleteTask(tasks[2].id)

    expect(await db.tasks.get(tasks[0].id)).toMatchObject({
      status: 'done',
      completedSubtasks: 1,
      totalSubtasks: 1,
    })
  })
})
