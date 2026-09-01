import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createPropertyDefinition, createTag, createThread, db, saveDay, saveThreadNote, setThreadIsTemplate, setThreadProperty, type TaskRecord } from '../db'
import { buildThreadSystemContext, loadThreadAppContext, renderThreadAppContext, THREAD_FEATURE_GUIDE } from './aiContext'
import { getThreadScriptHelp } from './threadscript/help'
import { initializeDatabase } from '../db'
import { addExercise, addSet, createWorkout, updateSet } from './workouts/mutations'
import { startWorkout } from './workouts/lifecycle'

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
    expect(context.threadScript.availableCommandCount).toBe(20)
  })

  it('includes the selected journal date and never constructs credential fields', async () => {
    await saveDay('2026-09-01', '- Today context')
    const context = await loadThreadAppContext('/?date=2026-09-01')
    const rendered = renderThreadAppContext(context)

    expect(context.activeDay).toEqual({ date: '2026-09-01', content: '- Today context', truncated: false })
    expect(rendered).not.toMatch(/apiKey|github_pat|credential|token/i)
  })

  it('attaches a bounded read-only active-workout payload when the lens is open', async () => {
    await initializeDatabase('2026-09-01')
    const workoutId = await createWorkout({ day: '2026-09-01', title: 'Push Day' })
    const exerciseId = await addExercise(workoutId, 'Bench Press')
    const setId = await addSet(exerciseId)
    await updateSet(setId, { load: 60, loadUnit: 'kg', reps: 8 })
    await startWorkout(workoutId)

    const context = await loadThreadAppContext(`/workout/2026-09-01/${workoutId}`)

    expect(context.activeView).toBe('workout')
    expect(context.activeWorkout).toMatchObject({
      taskId: workoutId,
      title: 'Push Day',
      status: 'in_progress',
      exercises: [{
        title: 'Bench Press',
        sets: [{ title: 'Set 1', status: 'not_started', measurements: { 'set-load': 60, 'set-load-unit': 'kg', 'set-reps': 8 } }],
      }],
    })
    expect(context.activeWorkout!.startedAt).toBeTypeOf('string')
    expect(THREAD_FEATURE_GUIDE).toContain('Workouts are ordinary tagged task subtrees')
  })

  it('surfaces the Training Plan thread and recent workouts only when the plan thread exists', async () => {
    await initializeDatabase('2026-09-03')

    const noPlan = await loadThreadAppContext('/')
    expect(noPlan.trainingPlan).toBeUndefined()
    expect(noPlan.recentWorkouts).toBeUndefined()

    await createThread('Training Plan')
    await saveThreadNote('training-plan', '- Goal: strength\n- Split: upper / lower')
    const older = await createWorkout({ day: '2026-09-01', title: 'Lower A' })
    await addExercise(older, 'Back Squat')
    const recent = await createWorkout({ day: '2026-09-03', title: 'Upper A' })
    const benchId = await addExercise(recent, 'Bench Press')
    const benchSet = await addSet(benchId)
    await updateSet(benchSet, { load: 60, loadUnit: 'kg', reps: 5 })

    const withPlan = await loadThreadAppContext('/')
    expect(withPlan.trainingPlan).toMatchObject({ id: 'training-plan', title: 'Training Plan', truncated: false })
    expect(withPlan.trainingPlan!.content).toContain('Split: upper / lower')
    expect(withPlan.recentWorkouts!.map((workout) => workout.title)).toEqual(['Upper A', 'Lower A'])
    expect(withPlan.recentWorkouts![0].exercises[0]).toMatchObject({
      title: 'Bench Press',
      sets: [{ status: 'not_started', measurements: { 'set-load': 60, 'set-load-unit': 'kg', 'set-reps': 5 } }],
    })
    expect(THREAD_FEATURE_GUIDE).toContain('workout.buildDay')
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

    expect(help.availableCommandCount).toBe(20)
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
    expect(help.categories.flatMap((category) => category.commands)).toHaveLength(20)
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

