import { useEffect, useMemo, useState } from 'react'
import { AlignJustify, ChevronDown, Check, List, Plus, Search } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSearchParams } from 'react-router-dom'
import { db, type BlockTagRecord, type MentionRecord, type TagDefinitionRecord, type TaskPriority, type TaskRecord, type TaskStatus } from '../db'
import { formatDay, isoToday } from '../lib/dates'
import { bulkSetTaskDueDate, bulkSetTaskPriority, bulkSetTaskStatus, createTask } from '../lib/tasks'
import { TaskDetails } from '../components/TaskDetails'
import { TaskRow, type TaskDisplayMode } from '../components/TaskRow'
import { TaskFilterPopover, type TaskFilterKey } from '../components/TaskFilterPopover'
import { Chip } from '../components/ui/Chip'

type TaskView = 'my-day' | 'in-progress' | 'overdue' | 'upcoming' | 'blocked' | 'unscheduled' | 'completed' | 'all'
type TaskSort = 'smart' | 'due' | 'priority' | 'updated'
type GroupBy = 'schedule' | 'status' | 'priority' | 'tag' | 'thread' | 'day'

const TASK_VIEWS: { id: TaskView; label: string }[] = [
  { id: 'my-day', label: 'My Day' },
  { id: 'in-progress', label: 'In Progress' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'unscheduled', label: 'Unscheduled' },
  { id: 'completed', label: 'Completed' },
  { id: 'all', label: 'All' },
]

const GROUP_OPTIONS: [GroupBy, string][] = [
  ['schedule', 'Schedule'],
  ['status', 'Status'],
  ['priority', 'Priority'],
  ['tag', 'Tag'],
  ['thread', 'Thread'],
  ['day', 'Source day'],
]

// My Day intentionally overlaps with Overdue: it's the broad "what to look at
// today" view, while Overdue stays the narrow audit view.
function matchesView(task: TaskRecord, view: TaskView, today: string): boolean {
  const isOpen = task.status !== 'done' && task.status !== 'canceled'
  switch (view) {
    case 'my-day':
      return isOpen && (task.dueDate === today || (!!task.dueDate && task.dueDate < today) || task.startDate === today)
    case 'in-progress':
      return task.status === 'in_progress'
    case 'blocked':
      return task.status === 'blocked'
    case 'overdue':
      return isOpen && !!task.dueDate && task.dueDate < today
    case 'upcoming':
      return isOpen && !!task.dueDate && task.dueDate > today
    case 'unscheduled':
      return isOpen && !task.dueDate
    case 'completed':
      return task.status === 'done'
    case 'all':
      return true
  }
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)')
    const onChange = () => setIsMobile(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return isMobile
}

export function TasksPage() {
  const tasks = useLiveQuery(() => db.tasks.toArray(), [], [])
  const tags = useLiveQuery(() => db.blockTags.toArray(), [], [])
  const tagDefinitions = useLiveQuery(() => db.tagDefinitions.orderBy('name').toArray(), [], [])
  const mentions = useLiveQuery(() => db.mentions.where('kind').equals('task').toArray(), [], [])
  const [params, setParams] = useSearchParams()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [detailsTaskId, setDetailsTaskId] = useState<string | null>(null)
  const [mobileViewOpen, setMobileViewOpen] = useState(false)
  const [mobileQuickAddOpen, setMobileQuickAddOpen] = useState(false)
  const isMobile = useIsMobile()

  const view = (params.get('view') as TaskView) || 'my-day'
  const priority = params.get('priority') || 'all'
  const tag = params.get('tag') || 'all'
  const thread = params.get('thread') || 'all'
  const sort = (params.get('sort') as TaskSort) || 'smart'
  const groupBy = (params.get('group') as GroupBy) || 'schedule'
  const mode = (params.get('mode') as TaskDisplayMode) || (isMobile ? 'compact' : 'list')
  const query = params.get('q') || ''
  const today = isoToday()

  const updateParam = (key: string, value: string, defaultValue = 'all') => {
    const next = new URLSearchParams(params)
    if (!value || value === defaultValue) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const threadOptions = useMemo(() => Array.from(new Map(mentions.map((item) => [item.threadId, item.title])).entries()), [mentions])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    const taggedIds = tag === 'all' ? null : new Set(tags.filter((item) => item.tagId === tag).map((item) => item.blockId))
    const threadedIds = thread === 'all' ? null : new Set(mentions.filter((item) => item.threadId === thread).map((item) => item.blockId))
    return tasks.filter((task) => {
      if (!matchesView(task, view, today)) return false
      if (priority !== 'all' && task.priority !== priority) return false
      if (taggedIds && !taggedIds.has(task.id)) return false
      if (threadedIds && !threadedIds.has(task.id)) return false
      if (normalized && !`${task.text} ${task.description ?? ''}`.toLocaleLowerCase().includes(normalized)) return false
      return true
    })
  }, [tasks, tags, tag, mentions, thread, view, priority, query, today])

  const groups = useMemo(() => groupTasks(filtered, groupBy, sort, today, { tags, tagDefinitions, mentions }), [filtered, groupBy, sort, today, tags, tagDefinitions, mentions])

  const viewCounts = useMemo(() => {
    const map = {} as Record<TaskView, number>
    TASK_VIEWS.forEach((item) => { map[item.id] = tasks.filter((task) => matchesView(task, item.id, today)).length })
    return map
  }, [tasks, today])

  const counts = useMemo(() => ({
    inProgress: tasks.filter((task) => task.status === 'in_progress').length,
    blocked: tasks.filter((task) => task.status === 'blocked').length,
    doneToday: tasks.filter((task) => task.status === 'done' && task.completedAt?.slice(0, 10) === today).length,
    dueToday: tasks.filter((task) => task.dueDate === today && task.status !== 'done').length,
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

  const activeFilterCount = [priority !== 'all', tag !== 'all', thread !== 'all', sort !== 'smart'].filter(Boolean).length
  const hasActiveFilters = activeFilterCount > 0 || !!query

  const onFilterChange = (key: TaskFilterKey, value: string) => updateParam(key, value, key === 'sort' ? 'smart' : 'all')

  const clearAllFilters = () => {
    const next = new URLSearchParams(params)
    ;['priority', 'tag', 'thread', 'sort', 'q'].forEach((key) => next.delete(key))
    setParams(next, { replace: true })
  }

  const currentView = TASK_VIEWS.find((item) => item.id === view) ?? TASK_VIEWS[0]

  return (
    <article className="tasks-page">
      <header className="tasks-hero tasks-hero-compact">
        <div>
          <h1>Tasks</h1>
          <span className="tasks-hero-count">{viewCounts['my-day']} for today</span>
        </div>
        <p>The outline keeps the context.</p>
      </header>

      {!isMobile && <QuickAdd autoFocus={params.get('create') === '1'} />}

      <div className="task-vitals" aria-label="Task summary">
        <div><span>{counts.inProgress}</span><small>in progress</small></div>
        <div><span>{counts.blocked}</span><small>blocked</small></div>
        <div><span>{counts.doneToday}</span><small>done today</small></div>
        <div><span>{counts.dueToday}</span><small>due today</small></div>
      </div>

      {isMobile ? (
        <button type="button" className="task-view-trigger" onClick={() => setMobileViewOpen(true)}>
          <span>{currentView.label}</span><small>{viewCounts[view]}</small><ChevronDown size={14} />
        </button>
      ) : (
        <nav className="task-view-tabs" aria-label="Task status view">
          {TASK_VIEWS.map((item) => <button type="button" key={item.id} className={view === item.id ? 'active' : ''} onClick={() => updateParam('view', item.id, 'my-day')}>{item.label}</button>)}
        </nav>
      )}

      <div className="task-controls-row">
        <label className="task-search"><Search size={15} /><input value={query} onChange={(event) => updateParam('q', event.target.value, '')} placeholder="Search tasks" /></label>
        <TaskFilterPopover priority={priority} tag={tag} thread={thread} sort={sort} tagDefinitions={tagDefinitions} threadOptions={threadOptions} onChange={onFilterChange} activeCount={activeFilterCount} />
        <FilterSelect label="Group by" value={groupBy} onChange={(value) => updateParam('group', value, 'schedule')} options={GROUP_OPTIONS} />
        <div className="task-mode-toggle" role="group" aria-label="Display mode">
          <button type="button" aria-pressed={mode === 'list'} aria-label="List view" onClick={() => updateParam('mode', 'list', isMobile ? 'compact' : 'list')}><List size={14} /></button>
          <button type="button" aria-pressed={mode === 'compact'} aria-label="Compact view" onClick={() => updateParam('mode', 'compact', isMobile ? 'compact' : 'list')}><AlignJustify size={14} /></button>
        </div>
      </div>

      {(hasActiveFilters) && <div className="task-filter-chips" aria-label="Active filters">
        {query && <Chip interactive onRemove={() => updateParam('q', '', '')}>&ldquo;{query}&rdquo;</Chip>}
        {priority !== 'all' && <Chip interactive onRemove={() => updateParam('priority', 'all')}>{priorityLabel(priority)}</Chip>}
        {tag !== 'all' && <Chip interactive onRemove={() => updateParam('tag', 'all')}>#{tagName(tag, tagDefinitions)}</Chip>}
        {thread !== 'all' && <Chip interactive accent="thread" onRemove={() => updateParam('thread', 'all')}>{threadTitle(thread, threadOptions)}</Chip>}
        {sort !== 'smart' && <Chip interactive onRemove={() => updateParam('sort', 'smart', 'smart')}>{sortLabel(sort)}</Chip>}
        <button type="button" className="task-filter-clear" onClick={clearAllFilters}>Clear all</button>
      </div>}

      {selected.size > 0 && <BulkBar ids={[...selected]} onClear={() => setSelected(new Set())} />}

      <>
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
              mode={mode}
              onToggle={(id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })}
              onSelect={(id, checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next })}
              onOpen={setDetailsTaskId}
            />)}
          </div>
        </section>)}
        {groups.length === 0 && <div className="tasks-empty"><Check size={24} /><h2>No tasks in this view</h2><p>Change a filter or capture the next thing you want to move forward.</p></div>}
      </>
      <TaskDetails taskId={detailsTaskId} onClose={() => setDetailsTaskId(null)} />

      {isMobile && <button type="button" className="task-fab" aria-label="Add task" onClick={() => setMobileQuickAddOpen(true)}><Plus size={22} /></button>}

      {isMobile && mobileQuickAddOpen && (
        <div className="layer-backdrop task-mobile-sheet-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) setMobileQuickAddOpen(false) }}>
          <div className="task-mobile-sheet" role="dialog" aria-label="Add task">
            <QuickAdd autoFocus onCreated={() => setMobileQuickAddOpen(false)} />
          </div>
        </div>
      )}

      {isMobile && mobileViewOpen && (
        <div className="layer-backdrop task-mobile-sheet-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) setMobileViewOpen(false) }}>
          <div className="task-mobile-sheet" role="dialog" aria-label="Choose view">
            {TASK_VIEWS.map((item) => <button type="button" key={item.id} className={`task-view-picker-row${view === item.id ? ' active' : ''}`} onClick={() => { updateParam('view', item.id, 'my-day'); setMobileViewOpen(false) }}>
              <span>{item.label}</span><small>{viewCounts[item.id]}</small>
            </button>)}
          </div>
        </div>
      )}
    </article>
  )
}

function priorityLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
function sortLabel(value: string): string {
  return value === 'due' ? 'Due date' : value === 'priority' ? 'By priority' : value === 'updated' ? 'Recently updated' : value
}
function tagName(id: string, tagDefinitions: TagDefinitionRecord[]): string {
  return tagDefinitions.find((item) => item.id === id)?.name ?? id
}
function threadTitle(id: string, threadOptions: [string, string][]): string {
  return threadOptions.find(([threadId]) => threadId === id)?.[1] ?? id
}

function QuickAdd({ autoFocus = false, onCreated }: { autoFocus?: boolean; onCreated?: () => void }) {
  const [text, setText] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<TaskPriority | ''>('')
  const [busy, setBusy] = useState(false)
  return <form className="task-quick-add" onSubmit={(event) => {
    event.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    void createTask({ text, dueDate: dueDate || undefined, priority: priority || undefined }).then(() => { setText(''); setDueDate(''); setPriority(''); onCreated?.() }).finally(() => setBusy(false))
  }}>
    <Plus size={18} />
    <input autoFocus={autoFocus} className="task-quick-title" value={text} onChange={(event) => setText(event.target.value)} placeholder="Add a task to today’s journal" aria-label="New task title" />
    <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="New task due date" />
    <select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority | '')} aria-label="New task priority"><option value="">Priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
    <button type="submit" disabled={!text.trim() || busy}>{busy ? 'Adding…' : 'Add task'}</button>
  </form>
}

function FilterSelect({ icon, label, value, options, onChange }: { icon?: React.ReactNode; label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
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
  mode: TaskDisplayMode
  onToggle: (id: string) => void
  onSelect: (id: string, checked: boolean) => void
  onOpen: (id: string) => void
}) {
  const direct = props.children.get(props.task.id) ?? []
  const isExpanded = props.expanded.has(props.task.id)
  return <>
    <TaskRow task={props.task} depth={props.depth} hasChildren={direct.length > 0} expanded={isExpanded} selected={props.selected.has(props.task.id)} tags={props.tags} tagDefinitions={props.tagDefinitions} mentions={props.mentions} mode={props.mode} onToggleExpanded={() => props.onToggle(props.task.id)} onSelect={(checked) => props.onSelect(props.task.id, checked)} onOpen={() => props.onOpen(props.task.id)} />
    {isExpanded && direct.map((task) => <TaskBranch {...props} task={task} depth={props.depth + 1} key={task.id} />)}
  </>
}

function BulkBar({ ids, onClear }: { ids: string[]; onClear: () => void }) {
  const [date, setDate] = useState('')
  return <div className="task-bulk-bar"><strong>{ids.length} selected</strong><button type="button" onClick={() => void bulkSetTaskStatus(ids, 'done').then(onClear)}>Complete</button><button type="button" onClick={() => void bulkSetTaskStatus(ids, 'in_progress').then(onClear)}>Start</button><select aria-label="Set selected priority" defaultValue="" onChange={(event) => { if (event.target.value) void bulkSetTaskPriority(ids, event.target.value as TaskPriority).then(onClear) }}><option value="">Set priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select><input type="date" aria-label="Set selected due date" value={date} onChange={(event) => { setDate(event.target.value); if (event.target.value) void bulkSetTaskDueDate(ids, event.target.value).then(onClear) }} /><button type="button" className="text-button" onClick={onClear}>Clear</button></div>
}

function scheduleGroups(roots: TaskRecord[], today: string) {
  return [
    { id: 'blocked', label: 'Blocked', tasks: roots.filter((task) => task.status === 'blocked') },
    { id: 'overdue', label: 'Overdue', tasks: roots.filter((task) => task.status !== 'blocked' && task.status !== 'done' && task.dueDate && task.dueDate < today) },
    { id: 'today', label: 'Today', tasks: roots.filter((task) => task.status !== 'blocked' && task.status !== 'done' && task.dueDate === today) },
    { id: 'upcoming', label: 'Upcoming', tasks: roots.filter((task) => task.status !== 'blocked' && task.status !== 'done' && task.dueDate && task.dueDate > today) },
    { id: 'unscheduled', label: 'Unscheduled', tasks: roots.filter((task) => task.status !== 'blocked' && task.status !== 'done' && !task.dueDate && task.status !== 'canceled') },
    { id: 'completed', label: 'Completed', tasks: roots.filter((task) => task.status === 'done') },
    { id: 'canceled', label: 'Canceled', tasks: roots.filter((task) => task.status === 'canceled') },
  ]
}

const STATUS_LABELS: Record<TaskStatus, string> = { not_started: 'Not started', in_progress: 'In Progress', blocked: 'Blocked', done: 'Completed', canceled: 'Canceled' }
function statusGroups(roots: TaskRecord[]) {
  const order: TaskStatus[] = ['not_started', 'in_progress', 'blocked', 'done', 'canceled']
  return order.map((status) => ({ id: status, label: STATUS_LABELS[status], tasks: roots.filter((task) => task.status === status) }))
}

function priorityGroups(roots: TaskRecord[]) {
  return [
    { id: 'high', label: 'High', tasks: roots.filter((task) => task.priority === 'high') },
    { id: 'medium', label: 'Medium', tasks: roots.filter((task) => task.priority === 'medium') },
    { id: 'low', label: 'Low', tasks: roots.filter((task) => task.priority === 'low') },
    { id: 'none', label: 'No priority', tasks: roots.filter((task) => !task.priority) },
  ]
}

function tagGroups(roots: TaskRecord[], tags: BlockTagRecord[], tagDefinitions: TagDefinitionRecord[]) {
  const byTag = new Map<string, TaskRecord[]>()
  const untagged: TaskRecord[] = []
  roots.forEach((task) => {
    const applied = tags.filter((item) => item.blockId === task.id)
    if (applied.length === 0) { untagged.push(task); return }
    applied.forEach((item) => {
      const list = byTag.get(item.tagId) ?? []
      list.push(task)
      byTag.set(item.tagId, list)
    })
  })
  const groups = Array.from(byTag.entries())
    .map(([tagId, taskList]) => ({ id: tagId, label: `#${tagDefinitions.find((definition) => definition.id === tagId)?.name ?? tagId}`, tasks: taskList }))
    .sort((a, b) => a.label.localeCompare(b.label))
  if (untagged.length) groups.push({ id: 'untagged', label: 'Untagged', tasks: untagged })
  return groups
}

function threadGroups(roots: TaskRecord[], mentions: MentionRecord[]) {
  const byThread = new Map<string, { title: string; tasks: TaskRecord[] }>()
  const unfiled: TaskRecord[] = []
  roots.forEach((task) => {
    const related = mentions.filter((item) => item.blockId === task.id)
    if (related.length === 0) { unfiled.push(task); return }
    related.forEach((item) => {
      const entry = byThread.get(item.threadId) ?? { title: item.title, tasks: [] }
      entry.tasks.push(task)
      byThread.set(item.threadId, entry)
    })
  })
  const groups = Array.from(byThread.entries())
    .map(([threadId, entry]) => ({ id: threadId, label: entry.title, tasks: entry.tasks }))
    .sort((a, b) => a.label.localeCompare(b.label))
  if (unfiled.length) groups.push({ id: 'unfiled', label: 'Unfiled', tasks: unfiled })
  return groups
}

function dayGroups(roots: TaskRecord[]) {
  const byDay = new Map<string, TaskRecord[]>()
  roots.forEach((task) => {
    const list = byDay.get(task.day) ?? []
    list.push(task)
    byDay.set(task.day, list)
  })
  return Array.from(byDay.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, taskList]) => ({ id: day, label: formatDay(day).full, tasks: taskList }))
}

function groupTasks(
  tasks: TaskRecord[],
  groupBy: GroupBy,
  sort: TaskSort,
  today: string,
  ctx: { tags: BlockTagRecord[]; tagDefinitions: TagDefinitionRecord[]; mentions: MentionRecord[] },
): Array<{ id: string; label: string; tasks: TaskRecord[] }> {
  const ids = new Set(tasks.map((task) => task.id))
  const roots = tasks.filter((task) => !task.parentTaskId || !ids.has(task.parentTaskId))
  const groups = groupBy === 'schedule' ? scheduleGroups(roots, today)
    : groupBy === 'status' ? statusGroups(roots)
    : groupBy === 'priority' ? priorityGroups(roots)
    : groupBy === 'tag' ? tagGroups(roots, ctx.tags, ctx.tagDefinitions)
    : groupBy === 'thread' ? threadGroups(roots, ctx.mentions)
    : dayGroups(roots)
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
