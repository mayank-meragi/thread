import { useMemo, useState } from 'react'
import { CalendarClock, Check, ChevronDown, ListFilter, ListTodo, Plus, Search, Sparkles } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSearchParams } from 'react-router-dom'
import { db, type BlockTagRecord, type MentionRecord, type TagDefinitionRecord, type TaskPriority, type TaskRecord, type TaskStatus } from '../db'
import { isoToday } from '../lib/dates'
import { bulkSetTaskDueDate, bulkSetTaskPriority, bulkSetTaskStatus, createTask } from '../lib/tasks'
import { TaskDetails } from '../components/TaskDetails'
import { TaskRow } from '../components/TaskRow'

type TaskView = 'active' | 'done' | 'all'
type ScheduleFilter = 'all' | 'overdue' | 'today' | 'upcoming' | 'unscheduled'
type TaskSort = 'smart' | 'due' | 'priority' | 'updated'

export function TasksPage() {
  const tasks = useLiveQuery(() => db.tasks.toArray(), [], [])
  const tags = useLiveQuery(() => db.blockTags.toArray(), [], [])
  const tagDefinitions = useLiveQuery(() => db.tagDefinitions.orderBy('name').toArray(), [], [])
  const mentions = useLiveQuery(() => db.mentions.where('kind').equals('task').toArray(), [], [])
  const [params, setParams] = useSearchParams()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [detailsTaskId, setDetailsTaskId] = useState<string | null>(null)

  const view = (params.get('view') as TaskView) || 'active'
  const schedule = (params.get('schedule') as ScheduleFilter) || 'all'
  const priority = params.get('priority') || 'all'
  const tag = params.get('tag') || 'all'
  const thread = params.get('thread') || 'all'
  const sort = (params.get('sort') as TaskSort) || 'smart'
  const query = params.get('q') || ''
  const today = isoToday()

  const updateParam = (key: string, value: string, defaultValue = 'all') => {
    const next = new URLSearchParams(params)
    if (!value || value === defaultValue) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    const taggedIds = tag === 'all' ? null : new Set(tags.filter((item) => item.tagId === tag).map((item) => item.blockId))
    const threadedIds = thread === 'all' ? null : new Set(mentions.filter((item) => item.threadId === thread).map((item) => item.blockId))
    return tasks.filter((task) => {
      if (view === 'active' && (task.status === 'done' || task.status === 'canceled')) return false
      if (view === 'done' && task.status !== 'done') return false
      if (priority !== 'all' && task.priority !== priority) return false
      if (taggedIds && !taggedIds.has(task.id)) return false
      if (threadedIds && !threadedIds.has(task.id)) return false
      if (normalized && !`${task.text} ${task.description ?? ''}`.toLocaleLowerCase().includes(normalized)) return false
      if (schedule === 'overdue' && (!task.dueDate || task.dueDate >= today)) return false
      if (schedule === 'today' && task.dueDate !== today) return false
      if (schedule === 'upcoming' && (!task.dueDate || task.dueDate <= today)) return false
      if (schedule === 'unscheduled' && task.dueDate) return false
      return true
    })
  }, [tasks, tags, tag, mentions, thread, view, priority, query, schedule, today])

  const groups = useMemo(() => groupTasks(filtered, sort, today), [filtered, sort, today])
  const counts = useMemo(() => ({
    active: tasks.filter((task) => task.status !== 'done' && task.status !== 'canceled').length,
    inProgress: tasks.filter((task) => task.status === 'in_progress').length,
    blocked: tasks.filter((task) => task.status === 'blocked').length,
    doneToday: tasks.filter((task) => task.status === 'done' && task.completedAt?.slice(0, 10) === today).length,
  }), [tasks, today])

  const children = useMemo(() => {
    const map = new Map<string, TaskRecord[]>()
    tasks.forEach((task) => {
      if (!task.parentTaskId) return
      const list = map.get(task.parentTaskId) ?? []
      list.push(task)
      map.set(task.parentTaskId, list)
    })
    return map
  }, [tasks])

  return (
    <article className="tasks-page">
      <header className="tasks-hero">
        <div>
          <span className="eyebrow">Across your journal</span>
          <h1>Tasks</h1>
          <p>Work the next line. The outline keeps the context.</p>
        </div>
        <div className="tasks-hero-mark"><ListTodo size={23} /><span>{counts.active}</span><small>active</small></div>
      </header>

      <QuickAdd autoFocus={params.get('create') === '1'} />

      <div className="task-vitals" aria-label="Task summary">
        <div><span>{counts.inProgress}</span><small>in progress</small></div>
        <div><span>{counts.blocked}</span><small>blocked</small></div>
        <div><span>{counts.doneToday}</span><small>done today</small></div>
        <div><span>{tasks.filter((task) => task.dueDate === today && task.status !== 'done').length}</span><small>due today</small></div>
      </div>

      <nav className="task-view-tabs" aria-label="Task status view">
        {(['active', 'done', 'all'] as TaskView[]).map((item) => <button type="button" key={item} className={view === item ? 'active' : ''} onClick={() => updateParam('view', item, 'active')}>{item === 'done' ? 'Completed' : item.charAt(0).toUpperCase() + item.slice(1)}</button>)}
      </nav>

      <div className="task-filter-bar">
        <label className="task-search"><Search size={15} /><input value={query} onChange={(event) => updateParam('q', event.target.value, '')} placeholder="Search tasks" /></label>
        <FilterSelect icon={<CalendarClock size={14} />} label="Schedule" value={schedule} onChange={(value) => updateParam('schedule', value)} options={[['all', 'Any date'], ['overdue', 'Overdue'], ['today', 'Today'], ['upcoming', 'Upcoming'], ['unscheduled', 'Unscheduled']]} />
        <FilterSelect icon={<Sparkles size={14} />} label="Priority" value={priority} onChange={(value) => updateParam('priority', value)} options={[['all', 'Any priority'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]} />
        {tagDefinitions.length > 0 && <FilterSelect icon={<ListFilter size={14} />} label="Tag" value={tag} onChange={(value) => updateParam('tag', value)} options={[['all', 'Any tag'], ...tagDefinitions.map((item) => [item.id, `#${item.name}`])]} />}
        {mentions.length > 0 && <FilterSelect label="Thread" value={thread} onChange={(value) => updateParam('thread', value)} options={[['all', 'Any thread'], ...Array.from(new Map(mentions.map((item) => [item.threadId, item.title])).entries())]} />}
        <FilterSelect label="Sort" value={sort} onChange={(value) => updateParam('sort', value, 'smart')} options={[['smart', 'Smart order'], ['due', 'Due date'], ['priority', 'Priority'], ['updated', 'Recently updated']]} />
      </div>

      {selected.size > 0 && <BulkBar ids={[...selected]} onClear={() => setSelected(new Set())} />}

      <div className="task-ledger">
        {groups.map((group) => <section className={`task-list-group group-${group.id}`} key={group.id}>
          <header><span>{group.label}</span><small>{group.tasks.length}</small></header>
          <div>
            {group.tasks.map((task) => <TaskBranch
              key={task.id}
              task={task}
              children={children}
              depth={0}
              expanded={expanded}
              selected={selected}
              tags={tags}
              tagDefinitions={tagDefinitions}
              mentions={mentions}
              onToggle={(id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })}
              onSelect={(id, checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next })}
              onOpen={setDetailsTaskId}
            />)}
          </div>
        </section>)}
        {groups.length === 0 && <div className="tasks-empty"><Check size={24} /><h2>No tasks in this view</h2><p>Change a filter or capture the next thing you want to move forward.</p></div>}
      </div>
      <TaskDetails taskId={detailsTaskId} onClose={() => setDetailsTaskId(null)} />
    </article>
  )
}

function QuickAdd({ autoFocus = false }: { autoFocus?: boolean }) {
  const [text, setText] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<TaskPriority | ''>('')
  const [busy, setBusy] = useState(false)
  return <form className="task-quick-add" onSubmit={(event) => {
    event.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    void createTask({ text, dueDate: dueDate || undefined, priority: priority || undefined }).then(() => { setText(''); setDueDate(''); setPriority('') }).finally(() => setBusy(false))
  }}>
    <Plus size={18} />
    <input autoFocus={autoFocus} className="task-quick-title" value={text} onChange={(event) => setText(event.target.value)} placeholder="Add a task to today’s journal" aria-label="New task title" />
    <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="New task due date" />
    <select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority | '')} aria-label="New task priority"><option value="">Priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
    <button type="submit" disabled={!text.trim() || busy}>{busy ? 'Adding…' : 'Add task'}</button>
  </form>
}

function FilterSelect({ icon, label, value, options, onChange }: { icon?: React.ReactNode; label: string; value: string; options: string[][]; onChange: (value: string) => void }) {
  return <label className="task-filter-select">{icon}<span className="sr-only">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}</select><ChevronDown size={12} /></label>
}

function TaskBranch(props: {
  task: TaskRecord
  children: Map<string, TaskRecord[]>
  depth: number
  expanded: Set<string>
  selected: Set<string>
  tags: BlockTagRecord[]
  tagDefinitions: TagDefinitionRecord[]
  mentions: MentionRecord[]
  onToggle: (id: string) => void
  onSelect: (id: string, checked: boolean) => void
  onOpen: (id: string) => void
}) {
  const direct = props.children.get(props.task.id) ?? []
  const isExpanded = props.expanded.has(props.task.id)
  return <>
    <TaskRow task={props.task} depth={props.depth} hasChildren={direct.length > 0} expanded={isExpanded} selected={props.selected.has(props.task.id)} tags={props.tags} tagDefinitions={props.tagDefinitions} mentions={props.mentions} onToggleExpanded={() => props.onToggle(props.task.id)} onSelect={(checked) => props.onSelect(props.task.id, checked)} onOpen={() => props.onOpen(props.task.id)} />
    {isExpanded && direct.map((task) => <TaskBranch {...props} task={task} depth={props.depth + 1} key={task.id} />)}
  </>
}

function BulkBar({ ids, onClear }: { ids: string[]; onClear: () => void }) {
  const [date, setDate] = useState('')
  return <div className="task-bulk-bar"><strong>{ids.length} selected</strong><button type="button" onClick={() => void bulkSetTaskStatus(ids, 'done').then(onClear)}>Complete</button><button type="button" onClick={() => void bulkSetTaskStatus(ids, 'in_progress').then(onClear)}>Start</button><select aria-label="Set selected priority" defaultValue="" onChange={(event) => { if (event.target.value) void bulkSetTaskPriority(ids, event.target.value as TaskPriority).then(onClear) }}><option value="">Set priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select><input type="date" aria-label="Set selected due date" value={date} onChange={(event) => { setDate(event.target.value); if (event.target.value) void bulkSetTaskDueDate(ids, event.target.value).then(onClear) }} /><button type="button" className="text-button" onClick={onClear}>Clear</button></div>
}

function groupTasks(tasks: TaskRecord[], sort: TaskSort, today: string): Array<{ id: string; label: string; tasks: TaskRecord[] }> {
  const ids = new Set(tasks.map((task) => task.id))
  const roots = tasks.filter((task) => !task.parentTaskId || !ids.has(task.parentTaskId))
  const groups = [
    { id: 'blocked', label: 'Blocked', tasks: roots.filter((task) => task.status === 'blocked') },
    { id: 'overdue', label: 'Overdue', tasks: roots.filter((task) => task.status !== 'blocked' && task.status !== 'done' && task.dueDate && task.dueDate < today) },
    { id: 'today', label: 'Today', tasks: roots.filter((task) => task.status !== 'blocked' && task.status !== 'done' && task.dueDate === today) },
    { id: 'upcoming', label: 'Upcoming', tasks: roots.filter((task) => task.status !== 'blocked' && task.status !== 'done' && task.dueDate && task.dueDate > today) },
    { id: 'unscheduled', label: 'Unscheduled', tasks: roots.filter((task) => task.status !== 'blocked' && task.status !== 'done' && !task.dueDate && task.status !== 'canceled') },
    { id: 'completed', label: 'Completed', tasks: roots.filter((task) => task.status === 'done') },
    { id: 'canceled', label: 'Canceled', tasks: roots.filter((task) => task.status === 'canceled') },
  ]
  return groups.map((group) => ({ ...group, tasks: sortTasks(group.tasks, sort) })).filter((group) => group.tasks.length)
}

function sortTasks(tasks: TaskRecord[], sort: TaskSort): TaskRecord[] {
  const priorities = { high: 0, medium: 1, low: 2 }
  return [...tasks].sort((a, b) => {
    if (sort === 'updated') return b.updatedAt.localeCompare(a.updatedAt)
    if (sort === 'priority') return (priorities[a.priority ?? 'low'] ?? 3) - (priorities[b.priority ?? 'low'] ?? 3) || a.order - b.order
    if (sort === 'due') return (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.order - b.order
    const statusOrder: Record<TaskStatus, number> = { blocked: 0, in_progress: 1, not_started: 2, done: 3, canceled: 4 }
    return statusOrder[a.status] - statusOrder[b.status] || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || (priorities[a.priority ?? 'low'] ?? 3) - (priorities[b.priority ?? 'low'] ?? 3) || a.order - b.order
  })
}
