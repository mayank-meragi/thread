import { useEffect, useRef, useState } from 'react'
import { Ban, Check, Circle, CircleDotDashed, LoaderCircle, OctagonAlert } from 'lucide-react'
import type { TaskRecord, TaskStatus } from '../db'
import { setTaskStatus } from '../lib/tasks'

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  canceled: 'Canceled',
}

export function TaskStatusIcon({ status, size = 16 }: { status: TaskStatus; size?: number }) {
  if (status === 'done') return <Check size={size} />
  if (status === 'in_progress') return <LoaderCircle size={size} />
  if (status === 'blocked') return <OctagonAlert size={size} />
  if (status === 'canceled') return <Ban size={size} />
  return <Circle size={size} />
}

export function TaskStatusControl({ task, compact = false }: { task: TaskRecord; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  const choose = async (status: TaskStatus) => {
    setOpen(false)
    let completeChildren = false
    if (status === 'done' && task.totalSubtasks > task.completedSubtasks) {
      completeChildren = window.confirm(`Complete all ${task.totalSubtasks - task.completedSubtasks} unfinished subtasks too?`)
    }
    await setTaskStatus(task.id, status, { completeChildren })
  }

  return (
    <div className="task-status-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`task-status-button status-${task.status}${compact ? ' compact' : ''}`}
        aria-label={`Status: ${TASK_STATUS_LABELS[task.status]}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <TaskStatusIcon status={task.status} size={compact ? 13 : 15} />
        {!compact && <span>{TASK_STATUS_LABELS[task.status]}</span>}
      </button>
      {open && <div className="menu-panel task-status-menu" role="menu">
        {(Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((status) => (
          <button type="button" role="menuitem" key={status} className={`menu-item status-${status}`} onClick={() => void choose(status)}>
            <TaskStatusIcon status={status} size={14} />
            <span>{TASK_STATUS_LABELS[status]}</span>
            {task.status === status && <CircleDotDashed size={12} />}
          </button>
        ))}
      </div>}
    </div>
  )
}
