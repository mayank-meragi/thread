// The task kind is the one example today of a kind with extra, queryable
// fields beyond its text/attribute marker (due date, priority). It's kept in
// its own dedicated Dexie table (db.tasks) rather than a generic blob, since
// those fields need to be indexed and queried (e.g. "what's due today").
//
// A future kind that wants its own structured fields follows this same shape:
// a small dedicated table plus a `mount` function like the one below, called
// generically by the editor for whichever <li> resolves to that kind. Nothing
// about the editor's tree-walk, id-pairing, or cleanup logic needs to change
// to add one.
import { db, updateTaskMetadata, type TaskPriority, type TaskRecord, type TaskStatus } from '../../db'
import { setTaskStatus } from '../tasks'

export function renderTaskChips(container: HTMLElement, task: TaskRecord): void {
  container.replaceChildren()
  if (task.status !== 'not_started' && task.status !== 'done') {
    const status = document.createElement('span')
    status.className = `task-meta-chip task-status-chip status-${task.status}`
    status.textContent = task.status === 'in_progress' ? 'In progress' : task.status.charAt(0).toUpperCase() + task.status.slice(1)
    container.append(status)
  }
  if (task.dueDate) {
    const due = document.createElement('span')
    due.className = 'task-meta-chip task-due-chip'
    due.textContent = formatCompactDate(task.dueDate)
    container.append(due)
  }
  if (task.priority) {
    const priority = document.createElement('span')
    priority.className = `task-meta-chip priority-${task.priority}`
    priority.textContent = task.priority.charAt(0).toUpperCase() + task.priority.slice(1)
    container.append(priority)
  }
  container.hidden = container.childElementCount === 0
}

function formatCompactDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    .format(new Date(`${date}T12:00:00`))
}

/** Mounts (or updates) the due-date/priority chips and edit row for one task <li>. */
export async function mountTaskExtras(item: HTMLElement, id: string, day: string, checked: boolean): Promise<void> {
  const persisted = await db.tasks.get(id)
  const task: TaskRecord = persisted ?? {
    id,
    blockId: id,
    day,
    line: 0,
    order: 0,
    text: item.textContent ?? '',
    checked,
    status: checked ? 'done' : 'not_started',
    statusSource: 'manual',
    completedSubtasks: 0,
    totalSubtasks: 0,
    updatedAt: '',
  }

  const children = item.querySelector<HTMLElement>(':scope > .children') ?? item
  let chips = item.querySelector<HTMLElement>(':scope > .children > .task-inline-meta')
  if (!chips) {
    chips = document.createElement('span')
    chips.className = 'task-inline-meta'
    chips.contentEditable = 'false'
    children.append(chips)
  }
  renderTaskChips(chips, task)

  let row = item.querySelector<HTMLElement>(':scope > .children > .task-metadata-row')
  if (!row) {
    row = document.createElement('div')
    row.className = 'task-metadata-row'
    row.contentEditable = 'false'
    row.innerHTML = '<label><span>Status</span><select class="task-status-input" aria-label="Task status"><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="done">Done</option><option value="canceled">Canceled</option></select></label><label><span>Due</span><input class="task-due-input" type="date" aria-label="Task due date"></label><label><span>Priority</span><select class="task-priority-input" aria-label="Task priority"><option value="">Add priority</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>'
    children.append(row)
  }

  const dueInput = row.querySelector<HTMLInputElement>('.task-due-input')!
  const priorityInput = row.querySelector<HTMLSelectElement>('.task-priority-input')!
  const statusInput = row.querySelector<HTMLSelectElement>('.task-status-input')!
  statusInput.value = task.status
  dueInput.value = task.dueDate ?? ''
  priorityInput.value = task.priority ?? ''
  statusInput.onchange = () => {
    void setTaskStatus(id, statusInput.value as TaskStatus).then(async () => {
      const updated = await db.tasks.get(id)
      if (updated) renderTaskChips(chips!, updated)
    })
  }
  dueInput.onchange = () => {
    void updateTaskMetadata(id, { dueDate: dueInput.value || undefined }).then(async () => {
      const updated = await db.tasks.get(id)
      if (updated) renderTaskChips(chips!, updated)
    })
  }
  priorityInput.onchange = () => {
    void updateTaskMetadata(id, { priority: priorityInput.value as TaskPriority || undefined }).then(async () => {
      const updated = await db.tasks.get(id)
      if (updated) renderTaskChips(chips!, updated)
    })
  }
}

/** Removes task chips/edit-row DOM and classes from a <li> that is no longer a task. */
export function clearTaskExtras(item: HTMLElement): void {
  item.classList.remove('task-block', 'task-focused')
  delete item.dataset.taskId
  item.querySelector(':scope > .children > .task-inline-meta')?.remove()
  item.querySelector(':scope > .children > .task-metadata-row')?.remove()
}
