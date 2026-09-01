import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Braces, CalendarDays, Check, Clock3, Copy,
  GitBranch, Hash, Link2, ListPlus, Plus, Sparkles, Tag, Trash2, X,
} from 'lucide-react'
import { addBlockTag, createTag, db, removeBlockTag, type TaskPriority } from '../db'
import { deleteBlock } from '../lib/blocks'
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
import { kindLabel } from '../lib/blockMetadata'
import { formatDay } from '../lib/dates'
import { closeInspector, getInspectorTarget, INSPECTOR_TARGET_EVENT, type InspectorTarget } from '../lib/inspectorTarget'
import { NewPropertyForm, PropertyField } from './inspector/PropertyField'
import { TaskDraft } from './inspector/TaskDraft'
import { WorkoutInspectorSections } from './inspector/WorkoutInspectorSections'
import { workoutRoleFromTagIds } from '../lib/workouts/systemTags'
import { TaskStatusControl } from './TaskStatusControl'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

// These built-in system properties only make sense on a task -- a plain
// thought/question/decision/idea block has no due date or status to track.
const TASK_ONLY_PROPERTY_IDS = new Set(['status', 'start-date', 'due-date', 'priority', 'estimate-minutes'])

// Workout/set measurements are edited through the role-specific inspector
// section (WorkoutInspectorSections), which validates across fields -- so they
// are kept out of the raw alphabetical property list on a tagged workout block.
const WORKOUT_PROPERTY_IDS = new Set([
  'workout-started-at', 'workout-finished-at',
  'set-load', 'set-load-unit', 'set-reps', 'set-rpe',
  'set-duration-seconds', 'set-distance', 'set-distance-unit',
])

export function ContextualInspector() {
  const [target, setTarget] = useState<InspectorTarget>(() => getInspectorTarget())
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const savedTimer = useRef<number | null>(null)

  // Reset per-target UI state (error/save indicator) during render when the
  // target changes, rather than in an effect -- this is the switching-key
  // React pattern for "clear derived state when an input identity changes",
  // and avoids the cascading-render effect the setState-in-effect lint flags.
  const targetKey = target ? `${target.kind}:${target.id}` : null
  const [lastTargetKey, setLastTargetKey] = useState(targetKey)
  if (targetKey !== lastTargetKey) {
    setLastTargetKey(targetKey)
    setError(null)
    setSaveState('idle')
  }

  useEffect(() => {
    const onChange = (event: Event) => setTarget((event as CustomEvent<InspectorTarget>).detail)
    window.addEventListener(INSPECTOR_TARGET_EVENT, onChange)
    return () => window.removeEventListener(INSPECTOR_TARGET_EVENT, onChange)
  }, [])

  useEffect(() => {
    if (!target) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeInspector()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [target])

  // Blocks and tasks share one `id` by construction (buildTaskRecords sets
  // both TaskRecord.id and .blockId to the source block's id), so a single
  // resilient lookup resolves the underlying block for either target kind.
  const block = useLiveQuery(async () => {
    if (!target) return undefined
    const direct = await db.blocks.get(target.id)
    if (direct) return direct
    // An editor mounted while the v6 migration was still reconciling can
    // briefly retain its former positional id. Resolve that one transitional
    // click through the persisted path map instead of presenting a dead end.
    const match = target.id.match(/^(\d{4}-\d{2}-\d{2}):(.+)$/)
    if (!match) return undefined
    const day = await db.days.get(match[1])
    const stableId = Object.entries(day?.metadata?.blocks ?? {}).find(([, item]) => item.path === match[2])?.[0]
    return stableId ? db.blocks.get(stableId) : undefined
  }, [target?.id])

  const task = useLiveQuery(
    () => target?.kind === 'task' ? db.tasks.get(target.id) : undefined,
    [target?.kind, target?.id],
  )
  const subtasks = useLiveQuery(
    () => task ? db.tasks.where('parentTaskId').equals(task.id).sortBy('order') : [],
    [task?.id],
    [],
  )

  const blockId = block?.id
  const definitions = useLiveQuery(() => db.propertyDefinitions.orderBy('name').toArray(), [], [])
  const properties = useLiveQuery(
    () => blockId ? db.blockProperties.where('blockId').equals(blockId).toArray() : [],
    [blockId],
    [],
  )
  const tags = useLiveQuery(() => db.tagDefinitions.orderBy('name').toArray(), [], [])
  const appliedTags = useLiveQuery(
    () => blockId ? db.blockTags.where('blockId').equals(blockId).toArray() : [],
    [blockId],
    [],
  )
  const backlinks = useLiveQuery(
    () => blockId ? db.mentions.where('blockId').equals(blockId).toArray() : [],
    [blockId],
    [],
  )

  const [newPropertyOpen, setNewPropertyOpen] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [subtaskText, setSubtaskText] = useState('')

  const values = useMemo(() => new Map(properties.map((property) => [property.propertyId, property.value])), [properties])
  const applied = new Set(appliedTags.map((item) => item.tagId))
  const schemaByProperty = useMemo(() => {
    const result = new Map<string, { tag: typeof tags[number]; required: boolean }>()
    for (const tag of tags.filter((item) => appliedTags.some((appliedTag) => appliedTag.tagId === item.id))) {
      for (const propertyId of tag.propertyIds) {
        if (!result.has(propertyId)) result.set(propertyId, { tag, required: tag.requiredPropertyIds?.includes(propertyId) ?? false })
      }
    }
    return result
  }, [tags, appliedTags])
  const isTaskTarget = block?.kind === 'task'
  const workoutRole = useMemo(() => workoutRoleFromTagIds(appliedTags.map((item) => item.tagId)), [appliedTags])
  const orderedDefinitions = useMemo(() => definitions.filter((definition) => {
    if (definition.hidden) return false
    // Workout roles get a curated, cross-validated section instead.
    if (workoutRole && WORKOUT_PROPERTY_IDS.has(definition.id)) return false
    // Task-only system fields (status, dates, priority, estimate) only make
    // sense to offer on a task -- but a plain block that already carries one
    // (e.g. from before a kind change) keeps showing it, so existing data
    // stays editable/removable rather than silently hidden.
    if (!isTaskTarget && TASK_ONLY_PROPERTY_IDS.has(definition.id) && values.get(definition.id) === undefined) return false
    return true
  }).sort((a, b) => {
    const schemaDifference = Number(schemaByProperty.has(b.id)) - Number(schemaByProperty.has(a.id))
    return schemaDifference || a.name.localeCompare(b.name)
  }), [definitions, schemaByProperty, isTaskTarget, values, workoutRole])

  if (!target) return null

  const run = async (operation: () => Promise<unknown>) => {
    setError(null)
    setSaveState('saving')
    try {
      await operation()
      setSaveState('saved')
      if (savedTimer.current) window.clearTimeout(savedTimer.current)
      savedTimer.current = window.setTimeout(() => setSaveState('idle'), 1500)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setSaveState('error')
    }
  }

  const kind = target.kind === 'task' ? 'task' : block?.kind
  const loaded = target.kind === 'task' ? Boolean(task) : Boolean(block)
  const day = target.kind === 'task' ? task?.day : block?.day
  const plainText = target.kind === 'task' ? task?.text : block?.plainText

  return (
    <div className="layer-backdrop layer-backdrop-end inspector-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeInspector()
    }}>
      <aside className="sheet inspector-panel" data-target-kind={target.kind} role="dialog" aria-modal="true" aria-labelledby="inspector-title">
        <header className="inspector-head">
          <div>
            <span className="inspector-kicker"><Braces size={13} /> {target.kind === 'task' ? 'Task record' : 'Block properties'}</span>
            <h2 id="inspector-title">{kind ? kindLabel(kind) : 'Details'}</h2>
            <span role="status" aria-live="polite" className={`inspector-save-status${saveState === 'saving' ? ' is-saving' : ''}${saveState === 'error' ? ' is-error' : ''}`}>
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Save failed' : ''}
            </span>
          </div>
          <button type="button" className="inspector-icon-button" aria-label="Close details" onClick={() => closeInspector()}><X size={17} /></button>
        </header>

        {!loaded && <div className="inspector-loading">Finding this {target.kind}…</div>}

        {loaded && <>
          <div className="inspector-source">
            <p>{plainText || 'Empty block'}</p>
            {day && <span><CalendarDays size={13} /> {formatDay(day).full}</span>}
            {day && blockId && <a href={`#/?date=${day}&block=${blockId}`} onClick={() => closeInspector()}><Link2 size={13} /> Open source</a>}
          </div>

          {task && <div className="task-detail-status"><TaskStatusControl task={task} /></div>}

          {task && <>
            <TaskDraft key={`title:${task.id}:${task.text}`} label="Title" value={task.text} multiline onSave={(value) => run(() => updateTaskTitle(task.id, value))} />
            <TaskDraft key={`description:${task.id}:${task.description}`} label="Description" value={task.description ?? ''} multiline placeholder="Add the context needed to finish this…" onSave={(value) => run(() => setTaskDescription(task.id, value))} />

            <div className="task-detail-grid">
              <label><span>Start</span><input type="date" value={task.startDate ?? ''} onChange={(event) => void run(() => setTaskStartDate(task.id, event.target.value || undefined))} /></label>
              <label><span>Due</span><input type="date" value={task.dueDate ?? ''} onChange={(event) => void run(() => setTaskDueDate(task.id, event.target.value || undefined))} /></label>
              <label><span>Priority</span><select value={task.priority ?? ''} onChange={(event) => void run(() => setTaskPriority(task.id, event.target.value as TaskPriority || undefined))}><option value="">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
              <EstimateField taskId={task.id} minutes={task.estimatedMinutes} run={run} />
            </div>
            {task.dueDate && task.startDate && task.dueDate < task.startDate && (
              <p className="field-hint field-hint-error">Due date is before the start date.</p>
            )}

            {task.totalSubtasks > 0 && <div className="task-detail-progress">
              <span><b>{Math.round((task.progress ?? 0) * 100)}%</b><small>{task.completedSubtasks} of {task.totalSubtasks} subtasks</small></span>
              <i><b style={{ width: `${Math.round((task.progress ?? 0) * 100)}%` }} /></i>
            </div>}

            <section className="inspector-section">
              <div className="inspector-section-title"><span>Subtasks</span><small>{subtasks.length}</small></div>
              {subtasks.map((subtask) => <button type="button" className="task-detail-subtask" key={subtask.id} onClick={() => { window.location.hash = `/?date=${subtask.day}&block=${subtask.id}` }}><span className={`subtask-dot status-${subtask.status}`} />{subtask.text}</button>)}
              <form className="task-detail-add" onSubmit={(event) => {
                event.preventDefault()
                if (!subtaskText.trim()) return
                void run(async () => { await createSubtask(task.id, subtaskText); setSubtaskText('') })
              }}>
                <ListPlus size={15} /><input value={subtaskText} onChange={(event) => setSubtaskText(event.target.value)} placeholder="Add a subtask" /><button type="submit">Add</button>
              </form>
            </section>

            {workoutRole && (
              <WorkoutInspectorSections
                task={task}
                values={values}
                role={workoutRole}
                run={run}
                onNavigate={closeInspector}
              />
            )}
          </>}

          <section className="inspector-section">
            <div className="inspector-section-title"><span><GitBranch size={14} /> Backlinks</span><small>{backlinks.length}</small></div>
            <div className="inspector-backlinks">
              {backlinks.map((mention) => (
                <a key={mention.id} className="inspector-backlink-row" href={`#/thread/${mention.threadId}`} onClick={() => closeInspector()}>
                  <small>{mention.title}</small>
                  <p>{mention.excerpt}</p>
                </a>
              ))}
              {backlinks.length === 0 && <p className="field-hint">Not mentioned in any thread yet.</p>}
            </div>
          </section>

          {blockId && <section className="inspector-section">
            <div className="inspector-section-title"><span><Tag size={14} /> Tags</span><small>{applied.size}</small></div>
            <div className="inspector-tags">
              {tags.map((tag) => {
                const application = appliedTags.find((item) => item.tagId === tag.id)
                return <button
                  type="button"
                  key={tag.id}
                  className={`${applied.has(tag.id) ? 'inspector-tag active' : 'inspector-tag'}${tag.propertyIds.length ? ' has-schema' : ''}${application?.source === 'inline' ? ' is-inline' : ''}`}
                  aria-pressed={applied.has(tag.id)}
                  title={application?.source === 'inline' ? 'Typed in this block' : tag.propertyIds.length ? 'Metadata schema' : undefined}
                  onClick={() => void run(() => applied.has(tag.id) ? removeBlockTag(blockId, tag.id) : addBlockTag(blockId, tag.id))}
                >
                  {tag.propertyIds.length > 0 ? <Sparkles size={11} /> : application?.source === 'inline' ? <Hash size={11} /> : applied.has(tag.id) ? <Check size={11} /> : null}#{tag.name}
                </button>
              })}
              <form className="inspector-inline-create" onSubmit={(event) => {
                event.preventDefault()
                const name = newTag.trim()
                if (!name) return
                void run(async () => {
                  const tag = await createTag(name)
                  await addBlockTag(blockId, tag.id)
                  setNewTag('')
                })
              }}>
                <Hash size={13} />
                <input value={newTag} onChange={(event) => setNewTag(event.target.value)} placeholder="New tag" aria-label="New tag name" />
                <button type="submit" aria-label="Create and add tag" disabled={!newTag.trim()}><Plus size={13} /></button>
              </form>
            </div>
          </section>}

          {blockId && <section className="inspector-section">
            <div className="inspector-section-title"><span><Braces size={14} /> Properties</span><small>{properties.length}</small></div>
            <div className="inspector-property-list">
              {orderedDefinitions.map((definition) => (
                <PropertyField
                  key={`${definition.id}:${JSON.stringify(values.get(definition.id))}`}
                  target={{ kind: 'block', blockId }}
                  definition={definition}
                  value={values.get(definition.id)}
                  schema={schemaByProperty.get(definition.id)}
                  onError={setError}
                />
              ))}
            </div>
            {newPropertyOpen
              ? <NewPropertyForm onDone={() => setNewPropertyOpen(false)} onError={setError} />
              : <button type="button" className="inspector-add-property" onClick={() => setNewPropertyOpen(true)}><Plus size={14} /> New property</button>}
          </section>}

          <section className="inspector-advanced">
            <div className="inspector-advanced-title">Advanced</div>
            {task && <div className="inspector-advanced-row">
              <button type="button" onClick={() => void run(() => moveTask(task.id, 'up'))}><ArrowUp size={14} /> Up</button>
              <button type="button" onClick={() => void run(() => moveTask(task.id, 'down'))}><ArrowDown size={14} /> Down</button>
              <button type="button" onClick={() => void run(() => changeTaskIndent(task.id, 'indent'))}><ArrowRight size={14} /> Indent</button>
              <button type="button" onClick={() => void run(() => changeTaskIndent(task.id, 'outdent'))}><ArrowLeft size={14} /> Outdent</button>
              <button type="button" onClick={() => void run(() => duplicateTask(task.id))}><Copy size={14} /> Duplicate</button>
              <button type="button" className="danger" onClick={() => {
                if (!window.confirm('Delete this task and all of its nested blocks?')) return
                void run(async () => { await deleteTask(task.id); closeInspector() })
              }}><Trash2 size={13} /> Delete task</button>
            </div>}
            {!task && blockId && <div className="inspector-advanced-row">
              <button type="button" className="danger" onClick={() => {
                if (!window.confirm('Delete this block and all of its nested blocks?')) return
                void run(async () => { await deleteBlock(blockId); closeInspector() })
              }}><Trash2 size={13} /> Delete block</button>
            </div>}
          </section>

          {error && <p className="banner banner-error inspector-error" role="alert">{error}</p>}

          <footer className="inspector-foot">
            {task?.estimatedMinutes && <span><Clock3 size={12} /> {task.estimatedMinutes} min</span>}
            <span>Stable ID</span><code>{blockId}</code>
          </footer>
        </>}
      </aside>
    </div>
  )
}

function EstimateField({ taskId, minutes, run }: { taskId: string; minutes: number | undefined; run: (operation: () => Promise<unknown>) => Promise<void> }) {
  const [draft, setDraft] = useState(minutes != null ? String(minutes) : '')
  const [validationError, setValidationError] = useState<string | null>(null)

  const commit = () => {
    if (draft.trim() === '') {
      setValidationError(null)
      void run(() => setTaskEstimate(taskId, undefined))
      return
    }
    const value = Number(draft)
    if (!Number.isFinite(value) || value <= 0) {
      setValidationError('Estimate must be a positive number of minutes.')
      return
    }
    setValidationError(null)
    void run(() => setTaskEstimate(taskId, value))
  }

  return (
    <label className={validationError ? 'field field-error' : 'field'}>
      <span>Estimate</span>
      <input className="field-control" type="number" min="1" value={draft} placeholder="Minutes" onChange={(event) => setDraft(event.target.value)} onBlur={commit} />
      {validationError && <small className="field-hint field-hint-error">{validationError}</small>}
    </label>
  )
}
