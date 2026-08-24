import { useEffect, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarDays, Clock3, Copy, Link2, ListPlus, Tag, Trash2, X } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { addBlockTag, createTag, db, removeBlockTag, type TaskPriority } from '../db'
import {
  changeTaskIndent,
  createSubtask,
  deleteTask,
  duplicateTask,
  moveTask,
  setTaskDescription,
  setTaskDueDate,
  setTaskEstimate,
  setTaskPriority,
  setTaskStartDate,
  updateTaskTitle,
} from '../lib/tasks'
import { formatDay } from '../lib/dates'
import { TaskStatusControl } from './TaskStatusControl'

export function TaskDetails({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const task = useLiveQuery(() => taskId ? db.tasks.get(taskId) : undefined, [taskId])
  const subtasks = useLiveQuery(() => taskId ? db.tasks.where('parentTaskId').equals(taskId).sortBy('order') : [], [taskId], [])
  const tags = useLiveQuery(() => db.tagDefinitions.orderBy('name').toArray(), [], [])
  const appliedTags = useLiveQuery(() => taskId ? db.blockTags.where('blockId').equals(taskId).toArray() : [], [taskId], [])
  const [subtaskText, setSubtaskText] = useState('')
  const [newTag, setNewTag] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!taskId) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [taskId, onClose])

  if (!taskId) return null
  const run = async (operation: () => Promise<unknown>) => {
    setError('')
    try { await operation() } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
  }

  return (
    <div className="layer-backdrop layer-backdrop-end task-detail-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <aside className="sheet task-detail-panel" role="dialog" aria-modal="true" aria-labelledby="task-detail-title">
        <header className="task-detail-head">
          <div><span className="task-detail-kicker">Task record</span><h2 id="task-detail-title">Details</h2></div>
          <button type="button" className="inspector-icon-button" aria-label="Close task details" onClick={onClose}><X size={17} /></button>
        </header>
        {task ? <>
          <div className="task-detail-status"><TaskStatusControl task={task} /></div>
          <TaskDraft key={`title:${task.id}:${task.text}`} label="Title" value={task.text} multiline onSave={(value) => updateTaskTitle(task.id, value)} />
          <TaskDraft key={`description:${task.id}:${task.description}`} label="Description" value={task.description ?? ''} multiline placeholder="Add the context needed to finish this…" onSave={(value) => setTaskDescription(task.id, value)} />

          <div className="task-detail-grid">
            <label><span>Start</span><input type="date" value={task.startDate ?? ''} onChange={(event) => void run(() => setTaskStartDate(task.id, event.target.value || undefined))} /></label>
            <label><span>Due</span><input type="date" value={task.dueDate ?? ''} onChange={(event) => void run(() => setTaskDueDate(task.id, event.target.value || undefined))} /></label>
            <label><span>Priority</span><select value={task.priority ?? ''} onChange={(event) => void run(() => setTaskPriority(task.id, event.target.value as TaskPriority || undefined))}><option value="">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
            <label><span>Estimate</span><input type="number" min="1" value={task.estimatedMinutes ?? ''} placeholder="Minutes" onChange={(event) => void run(() => setTaskEstimate(task.id, event.target.value ? Number(event.target.value) : undefined))} /></label>
          </div>

          {task.totalSubtasks > 0 && <div className="task-detail-progress">
            <span><b>{Math.round((task.progress ?? 0) * 100)}%</b><small>{task.completedSubtasks} of {task.totalSubtasks} subtasks</small></span>
            <i><b style={{ width: `${Math.round((task.progress ?? 0) * 100)}%` }} /></i>
          </div>}

          <section className="task-detail-section">
            <div className="task-detail-section-title"><span>Subtasks</span><small>{subtasks.length}</small></div>
            {subtasks.map((subtask) => <button type="button" className="task-detail-subtask" key={subtask.id} onClick={() => { window.location.hash = `/?date=${subtask.day}&block=${subtask.id}` }}><span className={`subtask-dot status-${subtask.status}`} />{subtask.text}</button>)}
            <form className="task-detail-add" onSubmit={(event) => {
              event.preventDefault()
              if (!subtaskText.trim()) return
              void run(async () => { await createSubtask(task.id, subtaskText); setSubtaskText('') })
            }}>
              <ListPlus size={15} /><input value={subtaskText} onChange={(event) => setSubtaskText(event.target.value)} placeholder="Add a subtask" /><button type="submit">Add</button>
            </form>
          </section>

          <section className="task-detail-section">
            <div className="task-detail-section-title"><span><Tag size={13} /> Tags</span><small>{appliedTags.length}</small></div>
            <div className="task-detail-tags">
              {tags.map((tag) => {
                const active = appliedTags.some((item) => item.tagId === tag.id)
                return <button type="button" key={tag.id} className={active ? 'active' : ''} onClick={() => void run(() => active ? removeBlockTag(task.id, tag.id) : addBlockTag(task.id, tag.id))}>#{tag.name}</button>
              })}
            </div>
            <form className="task-detail-add" onSubmit={(event) => {
              event.preventDefault()
              if (!newTag.trim()) return
              void run(async () => { const tag = await createTag(newTag); await addBlockTag(task.id, tag.id); setNewTag('') })
            }}><Tag size={14} /><input value={newTag} onChange={(event) => setNewTag(event.target.value)} placeholder="Create a tag" /><button type="submit">Add</button></form>
          </section>

          <section className="task-detail-section task-detail-actions">
            <div className="task-detail-section-title"><span>Arrange</span></div>
            <div>
              <button type="button" onClick={() => void run(() => moveTask(task.id, 'up'))}><ArrowUp size={14} /> Up</button>
              <button type="button" onClick={() => void run(() => moveTask(task.id, 'down'))}><ArrowDown size={14} /> Down</button>
              <button type="button" onClick={() => void run(() => changeTaskIndent(task.id, 'indent'))}><ArrowRight size={14} /> Indent</button>
              <button type="button" onClick={() => void run(() => changeTaskIndent(task.id, 'outdent'))}><ArrowLeft size={14} /> Outdent</button>
              <button type="button" onClick={() => void run(() => duplicateTask(task.id))}><Copy size={14} /> Duplicate</button>
            </div>
          </section>

          {error && <p className="banner banner-error inspector-error" role="alert">{error}</p>}
          <footer className="task-detail-foot">
            <span><CalendarDays size={12} /> Created in {formatDay(task.day).full}</span>
            {task.estimatedMinutes && <span><Clock3 size={12} /> {task.estimatedMinutes} min</span>}
            <a href={`#/?date=${task.day}&block=${task.id}`} onClick={onClose}><Link2 size={12} /> Open source</a>
            <button type="button" onClick={() => {
              if (!window.confirm('Delete this task and all of its nested blocks?')) return
              void run(async () => { await deleteTask(task.id); onClose() })
            }}><Trash2 size={13} /> Delete</button>
          </footer>
        </> : <div className="inspector-loading">Finding this task…</div>}
      </aside>
    </div>
  )
}

function TaskDraft({ label, value, placeholder, multiline, onSave }: { label: string; value: string; placeholder?: string; multiline?: boolean; onSave: (value: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value)
  const control = multiline
    ? <textarea rows={label === 'Title' ? 2 : 4} value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft !== value) void onSave(draft) }} />
    : <input value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft !== value) void onSave(draft) }} />
  return <label className={`task-detail-draft task-detail-${label.toLocaleLowerCase()}`}><span>{label}</span>{control}</label>
}
