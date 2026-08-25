import { useState } from 'react'
import { CalendarPlus, Clock3, ListTree, Tag } from 'lucide-react'
import type { BlockTagRecord, MentionRecord, TagDefinitionRecord, TaskRecord, TaskStatus } from '../db'
import { formatDay, isoToday } from '../lib/dates'
import { setTaskStatus } from '../lib/tasks'
import { TaskStatusIcon } from './TaskStatusControl'

const EMPTY_SELECTION = new Set<string>()
function NOOP_SELECT(): void {}

const BOARD_COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: 'not_started', label: 'Not started' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'done', label: 'Completed' },
  { id: 'canceled', label: 'Canceled' },
]

export function TaskBoard({
  tasks,
  tags,
  tagDefinitions,
  mentions,
  selectable = true,
  selected = EMPTY_SELECTION,
  onSelect = NOOP_SELECT,
  onOpen,
}: {
  tasks: TaskRecord[]
  tags: BlockTagRecord[]
  tagDefinitions: TagDefinitionRecord[]
  mentions: MentionRecord[]
  selectable?: boolean
  selected?: Set<string>
  onSelect?: (id: string, checked: boolean) => void
  onOpen: (id: string) => void
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null)

  const drop = async (taskId: string, status: TaskStatus) => {
    const task = tasks.find((item) => item.id === taskId)
    if (!task || task.status === status) return
    let completeChildren = false
    if (status === 'done' && task.totalSubtasks > task.completedSubtasks) {
      completeChildren = window.confirm(`Complete all ${task.totalSubtasks - task.completedSubtasks} unfinished subtasks too?`)
    }
    await setTaskStatus(taskId, status, { completeChildren })
  }

  return (
    <div className="task-board" role="group" aria-label="Task board">
      {BOARD_COLUMNS.map((column) => {
        const columnTasks = tasks.filter((task) => task.status === column.id)
        return (
          <section
            key={column.id}
            className={`task-board-column status-${column.id}${dragOverStatus === column.id ? ' is-drag-over' : ''}`}
            onDragOver={(event) => { if (draggingId) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOverStatus(column.id) } }}
            onDragLeave={() => setDragOverStatus((current) => (current === column.id ? null : current))}
            onDrop={(event) => {
              event.preventDefault()
              setDragOverStatus(null)
              const taskId = event.dataTransfer.getData('text/plain')
              if (taskId) void drop(taskId, column.id)
            }}
          >
            <header>
              <TaskStatusIcon status={column.id} size={13} />
              <span>{column.label}</span>
              <small>{columnTasks.length}</small>
            </header>
            <div className="task-board-column-body">
              {columnTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  tags={tags}
                  tagDefinitions={tagDefinitions}
                  mentions={mentions}
                  selectable={selectable}
                  selected={selected.has(task.id)}
                  dragging={draggingId === task.id}
                  onSelect={(checked) => onSelect(task.id, checked)}
                  onOpen={() => onOpen(task.id)}
                  onDragStart={() => setDraggingId(task.id)}
                  onDragEnd={() => { setDraggingId(null); setDragOverStatus(null) }}
                />
              ))}
              {columnTasks.length === 0 && <p className="task-board-empty">No tasks</p>}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function TaskCard({
  task,
  tags,
  tagDefinitions,
  mentions,
  selectable,
  selected,
  dragging,
  onSelect,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  task: TaskRecord
  tags: BlockTagRecord[]
  tagDefinitions: TagDefinitionRecord[]
  mentions: MentionRecord[]
  selectable: boolean
  selected: boolean
  dragging: boolean
  onSelect: (checked: boolean) => void
  onOpen: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const appliedTags = tags
    .filter((item) => item.blockId === task.id)
    .map((item) => tagDefinitions.find((tag) => tag.id === item.tagId))
    .filter((tag): tag is TagDefinitionRecord => Boolean(tag))
  const relatedThreads = mentions.filter((mention) => mention.blockId === task.id)
  const overdue = !!task.dueDate && task.dueDate < isoToday() && task.status !== 'done'

  return (
    <div
      className={`task-board-card${dragging ? ' is-dragging' : ''}${selected ? ' is-selected' : ''}`}
      draggable
      onDragStart={(event) => { event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move'; onDragStart() }}
      onDragEnd={onDragEnd}
    >
      <div className="task-board-card-top">
        {selectable && <label className="task-select-control">
          <input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} />
          <span />
        </label>}
        {task.priority && <span className={`priority-dot priority-${task.priority}`} title={`${task.priority} priority`} />}
      </div>
      <button type="button" className="task-board-card-body" onClick={onOpen}>
        <span className="task-row-title">{task.text}</span>
        {task.description && <span className="task-row-description">{task.description}</span>}
        <span className="task-board-card-foot">
          <span title={`Logged ${formatDay(task.day).full}`}><CalendarPlus size={11} /> {formatDay(task.day).short}</span>
          {task.dueDate && <span className={overdue ? 'task-date-overdue' : ''} title={`Due ${formatDay(task.dueDate).full}`}><Clock3 size={11} /> {formatDay(task.dueDate).short}</span>}
          {task.totalSubtasks > 0 && <span><ListTree size={11} /> {task.completedSubtasks}/{task.totalSubtasks}</span>}
          {appliedTags.slice(0, 2).map((tag) => <span key={tag.id}><Tag size={10} /> {tag.name}</span>)}
          {relatedThreads.slice(0, 2).map((mention) => <span key={mention.threadId}>#{mention.title}</span>)}
        </span>
      </button>
    </div>
  )
}
