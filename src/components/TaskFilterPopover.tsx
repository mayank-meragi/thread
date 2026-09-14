import { Button, Field, Popover, Select } from 'fiber'
import { useState } from 'react'
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

  return (
    <div className="task-filter-popover">
      <Popover
        open={open}
        onOpenChange={setOpen}
        placement="bottom-start"
        contentRole="dialog"
        className="menu-panel task-filter-panel"
        aria-label="Filter tasks"
        data-density="compact"
        trigger={
          <Button unstyled type="button" className="task-filter-trigger">
            <ListFilter size={14} />
            <span>Filters</span>
            {activeCount > 0 && <span className="task-filter-trigger-badge">{activeCount}</span>}
          </Button>
        }
      >
            <Field label="Priority">
              <Select value={priority} onChange={(event) => onChange('priority', event.target.value)}>
                <option value="all">Any priority</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </Select>
            </Field>
            {tagDefinitions.length > 0 && (
              <Field label="Tag">
                <Select value={tag} onChange={(event) => onChange('tag', event.target.value)}>
                  <option value="all">Any tag</option>
                  {tagDefinitions.map((item) => <option key={item.id} value={item.id}>#{item.name}</option>)}
                </Select>
              </Field>
            )}
            {threadOptions.length > 0 && (
              <Field label="Thread">
                <Select value={thread} onChange={(event) => onChange('thread', event.target.value)}>
                  <option value="all">Any thread</option>
                  {threadOptions.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Sort">
              <Select value={sort} onChange={(event) => onChange('sort', event.target.value)}>
                <option value="smart">Smart order</option>
                <option value="due">Due date</option>
                <option value="priority">Priority</option>
                <option value="updated">Recently updated</option>
              </Select>
            </Field>
      </Popover>
    </div>
  )
}
