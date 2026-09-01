import {
  addBlockTag,
  db,
  removeBlockProperty,
  saveDay,
  setBlockProperty,
  type TaskPriority,
  type TaskRecord,
  type TaskStatus,
} from '../db'
import { isoToday } from './dates'
import { systemTagIdForWorkoutRole, type WorkoutRole } from './workouts/systemTags'

async function persistTaskMarkdown(day: string, markdown: string): Promise<void> {
  await saveDay(day, markdown)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('thread:day-external-update', { detail: { day, markdown } }))
  }
}

async function sourceForTask(taskId: string): Promise<{ task: TaskRecord; blocks: import('./outline').OutlineBlock[]; lines: string[] }> {
  const task = await db.tasks.get(taskId)
  if (!task) throw new Error('This task no longer exists.')
  const day = await db.days.get(task.day)
  if (!day) throw new Error('The source day no longer exists.')
  const blocks = await db.blocks.where('day').equals(task.day).sortBy('order')
  return { task, blocks, lines: day.markdown.split('\n') }
}

function subtreeEnd(blocks: import('./outline').OutlineBlock[], rootIndex: number): number {
  const root = blocks[rootIndex]
  let index = rootIndex + 1
  while (index < blocks.length && blocks[index].depth > root.depth) index += 1
  return index
}

function taskLinePrefix(line: string): RegExpMatchArray | null {
  return line.match(/^(\s*(?:[-*+]|\d+\.)\s+)\[[ xX]\](\s+)/)
}

async function writeCheckbox(taskId: string, done: boolean): Promise<void> {
  const { task, blocks, lines } = await sourceForTask(taskId)
  const block = blocks.find((candidate) => candidate.id === taskId)
  if (!block) throw new Error('The task source could not be found.')
  const line = lines[block.order]
  lines[block.order] = done
    ? line.replace(/^(\s*(?:[-*+]|\d+\.)\s+)\[[ xX]\]/, '$1[x]')
    : line.replace(/^(\s*(?:[-*+]|\d+\.)\s+)\[[ xX]\]/, '$1[ ]')
  await persistTaskMarkdown(task.day, lines.join('\n'))
}

async function writeStatus(taskId: string, status: TaskStatus, source: 'manual' | 'derived'): Promise<void> {
  await writeCheckbox(taskId, status === 'done')
  await setBlockProperty(taskId, 'status', status, source === 'derived' ? 'derived' : 'explicit')
  await setBlockProperty(taskId, 'status-source', source, source === 'derived' ? 'derived' : 'explicit')
}

function descendantsOf(taskId: string, tasks: TaskRecord[]): TaskRecord[] {
  const children = new Map<string, TaskRecord[]>()
  tasks.forEach((task) => {
    if (!task.parentTaskId) return
    const list = children.get(task.parentTaskId) ?? []
    list.push(task)
    children.set(task.parentTaskId, list)
  })
  const result: TaskRecord[] = []
  const visit = (id: string) => {
    for (const child of children.get(id) ?? []) {
      result.push(child)
      visit(child.id)
    }
  }
  visit(taskId)
  return result
}

async function recomputeAncestors(taskId: string, parentTaskId?: string): Promise<void> {
  let tasks = await db.tasks.toArray()
  let current = parentTaskId ?? tasks.find((task) => task.id === taskId)?.parentTaskId
  while (current) {
    const parent = tasks.find((task) => task.id === current)
    if (!parent || parent.statusSource === 'manual') break
    const descendants = descendantsOf(parent.id, tasks)
    const parentIds = new Set(descendants.map((item) => item.parentTaskId).filter(Boolean))
    const leaves = descendants.filter((item) => !parentIds.has(item.id) && item.status !== 'canceled')
    const next: TaskStatus = leaves.length > 0 && leaves.every((item) => item.status === 'done')
      ? 'done'
      : leaves.some((item) => item.status !== 'not_started') ? 'in_progress' : 'not_started'
    if (parent.status !== next || parent.statusSource !== 'derived') await writeStatus(parent.id, next, 'derived')
    tasks = await db.tasks.toArray()
    current = parent.parentTaskId
  }
}

export async function setTaskStatus(taskId: string, status: TaskStatus, options?: { completeChildren?: boolean }): Promise<void> {
  const tasks = await db.tasks.toArray()
  const task = tasks.find((candidate) => candidate.id === taskId)
  if (!task) throw new Error('This task no longer exists.')
  if (status === 'done' && options?.completeChildren) {
    for (const child of descendantsOf(taskId, tasks).filter((item) => item.status !== 'done' && item.status !== 'canceled')) {
      await writeStatus(child.id, 'done', 'manual')
    }
  }
  await writeStatus(taskId, status, 'manual')
  await recomputeAncestors(taskId)
}

export async function createTask(input: {
  text: string
  day?: string
  dueDate?: string
  priority?: TaskPriority
  description?: string
}): Promise<string> {
  const day = input.day ?? isoToday()
  const record = await db.days.get(day)
  const markdown = record?.markdown.trimEnd() ?? ''
  const next = `${markdown}${markdown ? '\n' : ''}- [ ] ${input.text.trim()}`
  await persistTaskMarkdown(day, next)
  const tasks = await db.tasks.where('day').equals(day).sortBy('order')
  const task = tasks.at(-1)
  if (!task) throw new Error('The new task could not be indexed.')
  if (input.dueDate) await setBlockProperty(task.id, 'due-date', input.dueDate)
  if (input.priority) await setBlockProperty(task.id, 'priority', input.priority)
  if (input.description) await setBlockProperty(task.id, 'description', input.description)
  return task.id
}

export async function createSubtask(parentTaskId: string, text: string): Promise<string> {
  const { task, blocks, lines } = await sourceForTask(parentTaskId)
  const rootIndex = blocks.findIndex((block) => block.id === parentTaskId)
  if (rootIndex < 0) throw new Error('The parent task source could not be found.')
  const insertBeforeBlock = blocks[subtreeEnd(blocks, rootIndex)]
  const insertAt = insertBeforeBlock?.order ?? lines.length
  const rootLine = lines[blocks[rootIndex].order]
  const indent = `${rootLine.match(/^\s*/)?.[0] ?? ''}  `
  lines.splice(insertAt, 0, `${indent}- [ ] ${text.trim()}`)
  await persistTaskMarkdown(task.day, lines.join('\n'))
  const refreshed = await db.tasks.where('day').equals(task.day).sortBy('order')
  const created = refreshed.find((item) => item.order === insertAt)
  if (!created) throw new Error('The new subtask could not be indexed.')
  return created.id
}

function workoutTaggedText(role: WorkoutRole, text: string): string {
  const label = role === 'set' && !text.trim() ? 'Set' : text.trim()
  return `#[${role}]${label ? ` ${label}` : ''}`
}

async function requireWorkoutSystemTag(role: WorkoutRole): Promise<void> {
  const tagId = systemTagIdForWorkoutRole(role)
  if (!await db.tagDefinitions.get(tagId)) throw new Error('Workout system tags are not initialized.')
}

export async function createWorkoutTask(input: { role: WorkoutRole; text: string; day?: string }): Promise<string> {
  await requireWorkoutSystemTag(input.role)
  return createTask({ text: workoutTaggedText(input.role, input.text), day: input.day })
}

export async function createWorkoutSubtask(parentTaskId: string, role: WorkoutRole, text = ''): Promise<string> {
  await requireWorkoutSystemTag(role)
  return createSubtask(parentTaskId, workoutTaggedText(role, text))
}

export async function updateTaskTitle(taskId: string, text: string): Promise<void> {
  const { task, blocks, lines } = await sourceForTask(taskId)
  const block = blocks.find((candidate) => candidate.id === taskId)
  if (!block) throw new Error('The task source could not be found.')
  const prefix = taskLinePrefix(lines[block.order])
  if (!prefix) throw new Error('The task Markdown is no longer valid.')
  lines[block.order] = `${prefix[1]}[${task.status === 'done' ? 'x' : ' '}]${prefix[2]}${text.trim()}`
  await persistTaskMarkdown(task.day, lines.join('\n'))
}

export async function setTaskDescription(taskId: string, description: string): Promise<void> {
  if (description.trim()) await setBlockProperty(taskId, 'description', description.trim())
  else await removeBlockProperty(taskId, 'description')
}

export async function setTaskDueDate(taskId: string, dueDate?: string): Promise<void> {
  if (dueDate) await setBlockProperty(taskId, 'due-date', dueDate)
  else await removeBlockProperty(taskId, 'due-date')
}

export async function setTaskStartDate(taskId: string, startDate?: string): Promise<void> {
  if (startDate) await setBlockProperty(taskId, 'start-date', startDate)
  else await removeBlockProperty(taskId, 'start-date')
}

export async function setTaskPriority(taskId: string, priority?: TaskPriority): Promise<void> {
  if (priority) await setBlockProperty(taskId, 'priority', priority)
  else await removeBlockProperty(taskId, 'priority')
}

export async function setTaskEstimate(taskId: string, minutes?: number): Promise<void> {
  if (minutes != null && Number.isFinite(minutes) && minutes > 0) await setBlockProperty(taskId, 'estimate-minutes', minutes)
  else await removeBlockProperty(taskId, 'estimate-minutes')
}

export async function deleteTask(taskId: string): Promise<void> {
  const { task, blocks, lines } = await sourceForTask(taskId)
  const rootIndex = blocks.findIndex((block) => block.id === taskId)
  const endIndex = subtreeEnd(blocks, rootIndex)
  const startLine = blocks[rootIndex].order
  const endLine = blocks[endIndex]?.order ?? lines.length
  lines.splice(startLine, endLine - startLine)
  await persistTaskMarkdown(task.day, lines.join('\n') || '- ')
  await recomputeAncestors(taskId, task.parentTaskId)
}

export async function duplicateTask(taskId: string): Promise<string> {
  const { task, blocks, lines } = await sourceForTask(taskId)
  const rootIndex = blocks.findIndex((block) => block.id === taskId)
  const endIndex = subtreeEnd(blocks, rootIndex)
  const startLine = blocks[rootIndex].order
  const endLine = blocks[endIndex]?.order ?? lines.length
  const duplicate = lines.slice(startLine, endLine)
  lines.splice(endLine, 0, ...duplicate)
  const properties = await db.blockProperties.where('blockId').equals(taskId).toArray()
  const tags = await db.blockTags.where('blockId').equals(taskId).toArray()
  await persistTaskMarkdown(task.day, lines.join('\n'))
  const created = (await db.tasks.where('day').equals(task.day).sortBy('order')).find((item) => item.order === endLine)
  if (!created) throw new Error('The duplicated task could not be indexed.')
  for (const property of properties) await setBlockProperty(created.id, property.propertyId, property.value, property.source)
  for (const tag of tags) await addBlockTag(created.id, tag.tagId)
  return created.id
}

export async function changeTaskIndent(taskId: string, direction: 'indent' | 'outdent'): Promise<void> {
  const { task, blocks, lines } = await sourceForTask(taskId)
  const rootIndex = blocks.findIndex((block) => block.id === taskId)
  const endIndex = subtreeEnd(blocks, rootIndex)
  const startLine = blocks[rootIndex].order
  const endLine = blocks[endIndex]?.order ?? lines.length
  if (direction === 'indent') {
    const previous = blocks.slice(0, rootIndex).reverse().find((block) => block.depth === blocks[rootIndex].depth)
    if (!previous) return
    for (let line = startLine; line < endLine; line += 1) lines[line] = `  ${lines[line]}`
  } else {
    if (blocks[rootIndex].depth === 0) return
    for (let line = startLine; line < endLine; line += 1) lines[line] = lines[line].replace(/^ {1,2}/, '')
  }
  await persistTaskMarkdown(task.day, lines.join('\n'))
}

export async function moveTask(taskId: string, direction: 'up' | 'down'): Promise<void> {
  const { task, blocks, lines } = await sourceForTask(taskId)
  const rootIndex = blocks.findIndex((block) => block.id === taskId)
  const root = blocks[rootIndex]
  const siblings = blocks.filter((block) => block.depth === root.depth && block.parentId === root.parentId)
  const siblingIndex = siblings.findIndex((block) => block.id === taskId)
  const target = siblings[siblingIndex + (direction === 'up' ? -1 : 1)]
  if (!target) return
  const targetIndex = blocks.findIndex((block) => block.id === target.id)
  const rootEnd = subtreeEnd(blocks, rootIndex)
  const targetEnd = subtreeEnd(blocks, targetIndex)
  const rootStartLine = root.order
  const rootEndLine = blocks[rootEnd]?.order ?? lines.length
  const targetStartLine = target.order
  const targetEndLine = blocks[targetEnd]?.order ?? lines.length
  const rootLines = lines.slice(rootStartLine, rootEndLine)
  const targetLines = lines.slice(targetStartLine, targetEndLine)
  if (direction === 'up') lines.splice(targetStartLine, rootEndLine - targetStartLine, ...rootLines, ...targetLines)
  else lines.splice(rootStartLine, targetEndLine - rootStartLine, ...targetLines, ...rootLines)
  await persistTaskMarkdown(task.day, lines.join('\n'))
}

export async function bulkSetTaskStatus(ids: string[], status: TaskStatus): Promise<void> {
  for (const id of ids) await setTaskStatus(id, status)
}

export async function bulkSetTaskDueDate(ids: string[], dueDate?: string): Promise<void> {
  for (const id of ids) await setTaskDueDate(id, dueDate)
}

export async function bulkSetTaskPriority(ids: string[], priority?: TaskPriority): Promise<void> {
  for (const id of ids) await setTaskPriority(id, priority)
}
