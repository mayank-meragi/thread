import { CalendarClock, Check } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db, toggleTask, type TaskRecord } from '../db'

interface TodayTasksProps {
  today: string
}

export function TodayTasks({ today }: TodayTasksProps) {
  const allTasks = useLiveQuery(() => db.tasks.toArray(), [], [])
  const tasks = allTasks.filter((task) => !task.checked && task.dueDate)
  const doneToday = sortTasks(allTasks.filter((task) => task.checked && task.completedAt?.slice(0, 10) === today))

  const overdue = sortTasks(tasks.filter((task) => task.dueDate! < today))
  const dueToday = sortTasks(tasks.filter((task) => task.dueDate === today), true)
  const upcoming = sortTasks(tasks.filter((task) => task.dueDate! > today))

  return (
    <section className="today-tasks" aria-labelledby="today-tasks-heading">
      <header className="today-tasks-heading">
        <div>
          <div className="eyebrow">Across your journal</div>
          <h2 id="today-tasks-heading">Tasks</h2>
        </div>
        <CalendarClock size={18} />
      </header>

      {overdue.length > 0 && <TaskGroup title="Overdue" tasks={overdue} tone="overdue" />}
      <TaskGroup title="Due today" tasks={dueToday} tone="today" empty="Nothing due today" />
      {upcoming.length > 0 && <TaskGroup title="Upcoming" tasks={upcoming} tone="upcoming" />}
      {doneToday.length > 0 && <TaskGroup title="Done today" tasks={doneToday} tone="done" />}
    </section>
  )
}

function TaskGroup({
  title,
  tasks,
  tone,
  empty,
}: {
  title: string
  tasks: TaskRecord[]
  tone: 'overdue' | 'today' | 'upcoming' | 'done'
  empty?: string
}) {
  const isDone = tone === 'done'
  return (
    <div className={`task-group task-group-${tone}`}>
      <div className="task-group-label"><span>{title}</span><small>{tasks.length}</small></div>
      {tasks.length ? tasks.map((task) => (
        <div className="today-task-row" key={task.id}>
          <button
            type="button"
            className={isDone ? 'task-check is-checked' : 'task-check'}
            aria-label={isDone ? `Mark ${task.text} not done` : `Complete ${task.text}`}
            onClick={() => void toggleTask(task)}
          >
            <Check size={12} />
          </button>
          <Link className={isDone ? 'today-task-text is-done' : 'today-task-text'} to={`/?date=${task.day}&block=${task.blockId}`}>{task.text}</Link>
          <span className="today-task-meta">
            {isDone
              ? task.completedAt && <time dateTime={task.completedAt}>{formatTaskTime(task.completedAt)}</time>
              : <time dateTime={task.dueDate}>{formatTaskDate(task.dueDate!)}</time>}
            {task.priority && <span className={`priority-chip priority-${task.priority}`}>{capitalize(task.priority)}</span>}
          </span>
        </div>
      )) : <div className="task-group-empty">{empty}</div>}
    </div>
  )
}

function sortTasks(tasks: TaskRecord[], priorityFirst = false): TaskRecord[] {
  const priority = { high: 0, medium: 1, low: 2 }
  return [...tasks].sort((a, b) => {
    if (priorityFirst) {
      const priorityOrder = (priority[a.priority ?? 'low'] ?? 3) - (priority[b.priority ?? 'low'] ?? 3)
      if (priorityOrder) return priorityOrder
    }
    if (a.dueDate || b.dueDate) return (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.order - b.order
    return (b.completedAt ?? '').localeCompare(a.completedAt ?? '') || a.order - b.order
  })
}

function formatTaskTime(date: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(date))
}

function formatTaskDate(date: string): string {
  const value = new Date(`${date}T12:00:00`)
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(value)
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
