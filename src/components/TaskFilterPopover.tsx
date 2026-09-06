import { useEffect, useRef, useState } from 'react'
import { ListFilter } from 'lucide-react'
import type { TagDefinitionRecord } from '../db'

export type TaskFilterKey = 'priority' | 'tag' | 'thread' | 'sort'

interface TaskFilterPopoverProps {
  priority: string
  tag: string
  thread: string
  sort: string
  tagDefinitions: TagDefinitionRecord[]
  threadOptions: [string, string][]
  onChange: (key: TaskFilterKey, value: string) => void
  activeCount: number
}

export function TaskFilterPopover({ priority, tag, thread, sort, tagDefinitions, threadOptions, onChange, activeCount }: TaskFilterPopoverProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onOutside = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="task-filter-popover" ref={wrapRef}>
      <button type="button" className="task-filter-trigger" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ListFilter size={14} />
        <span>Filters</span>
        {activeCount > 0 && <span className="task-filter-trigger-badge">{activeCount}</span>}
      </button>
      {open && (
        <>
          <div className="task-filter-backdrop" onClick={() => setOpen(false)} />
          <div className="menu-panel task-filter-panel" role="dialog" aria-label="Filter tasks">
            <div className="field">
              <span className="field-label">Priority</span>
              <select className="field-control" value={priority} onChange={(event) => onChange('priority', event.target.value)}>
                <option value="all">Any priority</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            {tagDefinitions.length > 0 && (
              <div className="field">
                <span className="field-label">Tag</span>
                <select className="field-control" value={tag} onChange={(event) => onChange('tag', event.target.value)}>
                  <option value="all">Any tag</option>
                  {tagDefinitions.map((item) => <option key={item.id} value={item.id}>#{item.name}</option>)}
                </select>
              </div>
            )}
            {threadOptions.length > 0 && (
              <div className="field">
                <span className="field-label">Thread</span>
                <select className="field-control" value={thread} onChange={(event) => onChange('thread', event.target.value)}>
                  <option value="all">Any thread</option>
                  {threadOptions.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
                </select>
              </div>
            )}
            <div className="field">
              <span className="field-label">Sort</span>
              <select className="field-control" value={sort} onChange={(event) => onChange('sort', event.target.value)}>
                <option value="smart">Smart order</option>
                <option value="due">Due date</option>
                <option value="priority">Priority</option>
                <option value="updated">Recently updated</option>
              </select>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
