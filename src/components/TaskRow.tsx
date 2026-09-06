import { useRef, useState } from 'react'
import { CalendarPlus, ChevronRight, Clock3, ListTree, Tag, Trash2 } from 'lucide-react'
import type { BlockTagRecord, MentionRecord, TagDefinitionRecord, TaskRecord } from '../db'
import { formatDay, isoToday, shiftDay } from '../lib/dates'
import { deleteTask, setTaskDueDate, setTaskStatus } from '../lib/tasks'
import { TaskStatusControl } from './TaskStatusControl'

export type TaskDisplayMode = 'list' | 'compact'

const SWIPE_COMPLETE_THRESHOLD = 72
const SWIPE_REVEAL_THRESHOLD = -72
const SWIPE_MAX = 96

export function TaskRow({
  task,
  depth = 0,
  hasChildren,
  expanded,
  selected,
  tags,
  tagDefinitions,
  mentions,
  mode = 'list',
  onToggleExpanded,
  onSelect,
  onOpen,
}: {
  task: TaskRecord
  depth?: number
  hasChildren: boolean
  expanded: boolean
  selected: boolean
  tags: BlockTagRecord[]
  tagDefinitions: TagDefinitionRecord[]
  mentions: MentionRecord[]
  mode?: TaskDisplayMode
  onToggleExpanded: () => void
  onSelect: (selected: boolean) => void
  onOpen: () => void
}) {
  const appliedTags = tags
    .filter((item) => item.blockId === task.id)
    .map((item) => tagDefinitions.find((tag) => tag.id === item.tagId))
    .filter((tag): tag is TagDefinitionRecord => Boolean(tag))
  const relatedThreads = mentions.filter((mention) => mention.blockId === task.id)
  const isCompact = mode === 'compact'

  const [dragX, setDragX] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; dragging: boolean } | null>(null)

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.pointerType !== 'touch') return
    dragRef.current = { startX: event.clientX, startY: event.clientY, dragging: false }
  }
  const onPointerMove = (event: React.PointerEvent) => {
    const state = dragRef.current
    if (!state) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.dragging) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
      if (Math.abs(dy) > Math.abs(dx)) { dragRef.current = null; return }
      state.dragging = true
    }
    setDragX(Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, dx)))
  }
  const endDrag = () => {
    const state = dragRef.current
    dragRef.current = null
    if (!state?.dragging) { setDragX(0); return }
    if (dragX > SWIPE_COMPLETE_THRESHOLD) void setTaskStatus(task.id, 'done')
    else if (dragX < SWIPE_REVEAL_THRESHOLD) setRevealed(true)
    setDragX(0)
  }

  return (
    <div className="task-row-swipe-wrap">
      {revealed && (
        <div className="task-row-swipe-actions">
          <button type="button" onClick={() => { void setTaskDueDate(task.id, shiftDay(isoToday(), 1)); setRevealed(false) }}>
            <Clock3 size={13} /> Tomorrow
          </button>
          <button type="button" className="danger" onClick={() => {
            if (window.confirm('Delete this task and all of its nested blocks?')) void deleteTask(task.id)
            setRevealed(false)
          }}>
            <Trash2 size={13} /> Delete
          </button>
        </div>
      )}
      <div
        className={`task-list-row status-${task.status}${isCompact ? ' is-compact' : ''}${revealed ? ' is-revealed' : ''}`}
        style={{ '--task-depth': depth, transform: dragX ? `translateX(${dragX}px)` : undefined } as React.CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <label className="task-select-control">
          <input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} />
          <span />
        </label>
        <button type="button" className="task-tree-toggle" disabled={!hasChildren} aria-label={expanded ? 'Collapse subtasks' : 'Expand subtasks'} aria-expanded={hasChildren ? expanded : undefined} onClick={onToggleExpanded}>
          {hasChildren && <ChevronRight size={14} />}
        </button>
        <TaskStatusControl task={task} compact />
        <button type="button" className="task-row-body" onClick={onOpen}>
          <span className="task-row-title">{task.text}</span>
          {task.description && !isCompact && <span className="task-row-description">{task.description}</span>}
          <span className="task-row-foot">
            {!isCompact && <span className="task-row-created" title={`Logged ${formatDay(task.day).full}`}><CalendarPlus size={11} /> {formatDay(task.day).short}</span>}
            {task.dueDate && <span className={task.dueDate < new Date().toISOString().slice(0, 10) && task.status !== 'done' ? 'task-date-overdue' : ''} title={`Due ${formatDay(task.dueDate).full}`}><Clock3 size={11} /> {formatDay(task.dueDate).short}</span>}
            {task.priority && (isCompact
              ? <span className={`priority-dot priority-${task.priority}`} title={`${task.priority} priority`} />
              : <span className={`task-priority-label priority-${task.priority}`}>{task.priority}</span>)}
            {!isCompact && appliedTags.slice(0, 2).map((tag) => <span key={tag.id}><Tag size={10} /> {tag.name}</span>)}
            {!isCompact && relatedThreads.slice(0, 2).map((mention) => <span key={mention.threadId}>#{mention.title}</span>)}
          </span>
        </button>
        <div className="task-row-progress">
          {task.totalSubtasks > 0 ? <>
            <span><ListTree size={12} /> {task.completedSubtasks}/{task.totalSubtasks}</span>
            {!isCompact && <span className="task-progress-track"><i style={{ width: `${Math.round((task.progress ?? 0) * 100)}%` }} /></span>}
          </> : null}
        </div>
      </div>
    </div>
  )
}
