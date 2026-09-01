import { useState } from 'react'
import { ChevronDown, ChevronRight, CircleCheck, Copy, ExternalLink, SkipForward, Trash2 } from 'lucide-react'
import { TaskStatusControl } from '../TaskStatusControl'
import { completeSet } from '../../lib/workouts/lifecycle'
import { deleteWorkoutItem, duplicateSet, skipSet } from '../../lib/workouts/mutations'
import { describeSet, sourceHref, stripStructuralTag } from '../../lib/workouts/presentation'
import type { WorkoutSetView } from '../../lib/workouts/types'
import { SetEditor } from './SetEditor'

export function SetRow({
  set,
  expanded,
  onToggleExpanded,
  onAdvance,
}: {
  set: WorkoutSetView
  expanded: boolean
  onToggleExpanded: () => void
  onAdvance?: (nextSetId: string | undefined) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const summary = describeSet(set.properties)
  const title = stripStructuralTag(set.task.text, 'set') || 'Set'

  const run = async (action: () => Promise<unknown>, advance = false) => {
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      if (advance) onAdvance?.(typeof result === 'string' ? result : undefined)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`set-row${set.task.status === 'done' ? ' is-done' : ''}${set.task.status === 'canceled' ? ' is-skipped' : ''}`}>
      <div className="set-row-head">
        <TaskStatusControl task={set.task} compact />
        <button type="button" className="set-row-title" aria-expanded={expanded} onClick={onToggleExpanded}>
          {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          <span>{title}</span>
          {summary && <small>{summary}</small>}
        </button>
        <div className="set-row-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Complete set"
            disabled={busy || set.task.status === 'done'}
            onClick={() => void run(() => completeSet(set.task.id), true)}
          >
            <CircleCheck size={15} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" aria-label="Duplicate set" disabled={busy} onClick={() => void run(() => duplicateSet(set.task.id))}>
            <Copy size={15} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" aria-label="Skip set" disabled={busy || set.task.status === 'canceled'} onClick={() => void run(() => skipSet(set.task.id))}>
            <SkipForward size={15} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" aria-label="Delete set" disabled={busy} onClick={() => void run(() => deleteWorkoutItem(set.task.id))}>
            <Trash2 size={15} aria-hidden="true" />
          </button>
          <a className="icon-button" aria-label="Open source line" href={sourceHref(set.task)}>
            <ExternalLink size={15} aria-hidden="true" />
          </a>
        </div>
      </div>
      {error && <p className="set-row-error" role="alert">{error}</p>}
      {expanded && (
        <SetEditor
          setTaskId={set.task.id}
          properties={set.properties}
          onSaved={onToggleExpanded}
        />
      )}
    </li>
  )
}
