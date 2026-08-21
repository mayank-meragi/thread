import { ChevronRight, Clock3, ListTree, Tag } from 'lucide-react'
import type { BlockTagRecord, MentionRecord, TagDefinitionRecord, TaskRecord } from '../db'
import { formatDay } from '../lib/dates'
import { TaskStatusControl } from './TaskStatusControl'

export function TaskRow({
  task,
  depth = 0,
  hasChildren,
  expanded,
  selected,
  tags,
  tagDefinitions,
  mentions,
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
  onToggleExpanded: () => void
  onSelect: (selected: boolean) => void
  onOpen: () => void
}) {
  const appliedTags = tags
    .filter((item) => item.blockId === task.id)
    .map((item) => tagDefinitions.find((tag) => tag.id === item.tagId))
    .filter((tag): tag is TagDefinitionRecord => Boolean(tag))
  const relatedThreads = mentions.filter((mention) => mention.blockId === task.id)

  return (
    <div className={`task-list-row status-${task.status}`} style={{ '--task-depth': depth } as React.CSSProperties}>
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
        {task.description && <span className="task-row-description">{task.description}</span>}
        <span className="task-row-foot">
          <span>{formatDay(task.day).short}</span>
          {task.dueDate && <span className={task.dueDate < new Date().toISOString().slice(0, 10) && task.status !== 'done' ? 'task-date-overdue' : ''}><Clock3 size={11} /> {formatDay(task.dueDate).short}</span>}
          {task.priority && <span className={`task-priority-label priority-${task.priority}`}>{task.priority}</span>}
          {appliedTags.slice(0, 2).map((tag) => <span key={tag.id}><Tag size={10} /> {tag.name}</span>)}
          {relatedThreads.slice(0, 2).map((mention) => <span key={mention.threadId}>#{mention.title}</span>)}
        </span>
      </button>
      <div className="task-row-progress">
        {task.totalSubtasks > 0 ? <>
          <span><ListTree size={12} /> {task.completedSubtasks}/{task.totalSubtasks}</span>
          <span className="task-progress-track"><i style={{ width: `${Math.round((task.progress ?? 0) * 100)}%` }} /></span>
        </> : null}
      </div>
    </div>
  )
}
