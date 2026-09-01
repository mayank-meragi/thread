import { useMemo, useState } from 'react'
import { AlignJustify, ArrowLeft, CheckCircle2, ChevronRight, Circle, GitBranch, HelpCircle, Kanban, Lightbulb, List, MoreHorizontal, Quote } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { db, toggleChecklistBlock, toggleTaskByBlockId, type BlockTagRecord, type MentionRecord, type TaskRecord, type ThreadOccurrenceRecord, type ViewStateRecord } from '../db'
import { formatDay } from '../lib/dates'
import { useOpenTab } from '../lib/tabsApi'
import { openBlockInspector, openTaskInspector } from '../lib/inspectorTarget'
import type { OutlineBlock } from '../lib/outline'
import { getExerciseOccurrences } from '../lib/workouts/selectors'
import { EditableThreadTitle } from '../components/EditableThreadTitle'
import { ThreadComposer } from '../components/ThreadComposer'
import { ThreadProperties } from '../components/ThreadProperties'
import { TaskBoard } from '../components/TaskBoard'
import { TaskBranch } from './TasksPage'
import type { TaskDisplayMode } from '../components/TaskRow'

type ThreadTaskMode = TaskDisplayMode | 'board'

export function ThreadPage() {
  const { threadId = '' } = useParams()
  const thread = useLiveQuery(() => db.threads.get(threadId), [threadId])
  const mentions = useLiveQuery(
    () => db.mentions.where('threadId').equals(threadId).reverse().sortBy('day'),
    [threadId],
    [],
  )
  const outlines = useLiveQuery(async () => {
    const occurrences = await db.occurrences.where('threadId').equals(threadId).toArray()
    occurrences.sort((a, b) => a.day.localeCompare(b.day) || a.order - b.order)
    const byDay = new Map<string, OutlineBlock[]>()
    for (const day of new Set(occurrences.map((item) => item.day))) {
      byDay.set(day, await db.blocks.where('day').equals(day).sortBy('order'))
    }
    return occurrences.map((occurrence) => {
      const dayBlocks = byDay.get(occurrence.day) ?? []
      const rootIndex = dayBlocks.findIndex((block) => block.id === occurrence.rootBlockId)
      const root = dayBlocks[rootIndex]
      if (!root) return { occurrence, blocks: [] }
      const blocks = [root]
      for (let index = rootIndex + 1; index < dayBlocks.length; index += 1) {
        if (dayBlocks[index].depth <= root.depth) break
        blocks.push(dayBlocks[index])
      }
      return { occurrence, blocks }
    })
  }, [threadId], [])
  const exerciseOccurrences = useLiveQuery(() => getExerciseOccurrences(threadId), [threadId], [])
  const view = `thread:${threadId}`
  const collapseStates = useLiveQuery(
    () => db.viewState.where('view').equals(view).toArray(),
    [view],
    [],
  )

  const taskIds = useMemo(
    () => Array.from(new Set(mentions.filter((item) => item.kind === 'task').map((item) => item.blockId))),
    [mentions],
  )
  const taskIdsKey = taskIds.join(',')
  const threadTasks = useLiveQuery(
    () => (taskIds.length ? db.tasks.where('id').anyOf(taskIds).toArray() : Promise.resolve([] as TaskRecord[])),
    [taskIdsKey],
    [] as TaskRecord[],
  )
  const threadTags = useLiveQuery(
    () => (taskIds.length ? db.blockTags.where('blockId').anyOf(taskIds).toArray() : Promise.resolve([] as BlockTagRecord[])),
    [taskIdsKey],
    [] as BlockTagRecord[],
  )
  const tagDefinitions = useLiveQuery(() => db.tagDefinitions.orderBy('name').toArray(), [], [])
  const taskMentions = useLiveQuery(
    () => (taskIds.length ? db.mentions.where('blockId').anyOf(taskIds).toArray() : Promise.resolve([] as MentionRecord[])),
    [taskIdsKey],
    [] as MentionRecord[],
  )

  const taskChildren = useMemo(() => {
    const map = new Map<string, TaskRecord[]>()
    threadTasks.forEach((task) => {
      if (!task.parentTaskId) return
      const list = map.get(task.parentTaskId) ?? []
      list.push(task)
      map.set(task.parentTaskId, list)
    })
    return map
  }, [threadTasks])
  const threadRoots = useMemo(() => {
    const ids = new Set(threadTasks.map((task) => task.id))
    return threadTasks.filter((task) => !task.parentTaskId || !ids.has(task.parentTaskId))
  }, [threadTasks])

  const [taskMode, setTaskMode] = useState<ThreadTaskMode>('board')
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set())

  if (!thread) return <div className="page-loading">Finding this thread…</div>

  const questions = mentions.filter((item) => item.kind === 'question' && !item.checked)
  const decisions = mentions.filter((item) => item.kind === 'decision')
  const ideas = mentions.filter((item) => item.kind === 'idea')
  const thoughts = mentions.filter(
    (item) => item.kind === 'thought' && item.excerpt.toLocaleLowerCase() !== thread.title.toLocaleLowerCase(),
  )
  const direction = thoughts.at(-1)?.excerpt ?? decisions.at(-1)?.excerpt

  return (
    <article className="thread-page">
      <Link to="/" className="back-link"><ArrowLeft size={15} /> Today</Link>
      <header className="thread-heading">
        <div className="thread-mark"><GitBranch size={21} /></div>
        <div>
          <div className="eyebrow">{thread.isTemplate ? 'Template' : 'Living thread'}</div>
          <EditableThreadTitle threadId={thread.id} title={thread.title} />
        </div>
      </header>

      <ThreadProperties threadId={thread.id} isTemplate={!!thread.isTemplate} />

      <ThreadComposer key={thread.id} threadId={thread.id} title={thread.title} />

      <ProjectionDisclosure title="All notes" meta={`${outlines.length} occurrences`} contentClassName="full-bleed">
        <div className="thread-occurrences">
          {outlines.map(({ occurrence, blocks }) => (
            <ThreadOccurrence
              key={occurrence.id}
              occurrence={occurrence}
              blocks={blocks}
              view={view}
              collapseStates={collapseStates}
              onInspect={openBlockInspector}
            />
          ))}
          {outlines.length === 0 && <div className="section-empty">No source outline is indexed yet</div>}
        </div>
      </ProjectionDisclosure>

      <ProjectionDisclosure title="Tasks" meta={threadTasks.length} contentClassName="full-bleed">
        {threadTasks.length === 0 ? (
          <div className="section-empty">No tasks linked to this thread yet — mention <code>[[{thread.title}]]</code> on a task to add one.</div>
        ) : (
          <>
            <div className="thread-task-toolbar">
              <div className="task-mode-toggle" role="group" aria-label="Display mode">
                <button type="button" aria-pressed={taskMode === 'list'} aria-label="List view" onClick={() => setTaskMode('list')}><List size={14} /></button>
                <button type="button" aria-pressed={taskMode === 'compact'} aria-label="Compact view" onClick={() => setTaskMode('compact')}><AlignJustify size={14} /></button>
                <button type="button" aria-pressed={taskMode === 'board'} aria-label="Board view" onClick={() => setTaskMode('board')}><Kanban size={14} /></button>
              </div>
            </div>
            {taskMode === 'board' ? (
              <TaskBoard
                tasks={threadRoots}
                tags={threadTags}
                tagDefinitions={tagDefinitions}
                mentions={taskMentions}
                selectable={false}
                onOpen={openTaskInspector}
              />
            ) : (
              <div className="thread-task-list">
                {threadRoots.map((task) => (
                  <TaskBranch
                    key={task.id}
                    task={task}
                    children={taskChildren}
                    depth={0}
                    expanded={expandedTasks}
                    selected={selectedTasks}
                    tags={threadTags}
                    tagDefinitions={tagDefinitions}
                    mentions={taskMentions}
                    mode={taskMode}
                    onToggle={(id) => setExpandedTasks((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })}
                    onSelect={(id, checked) => setSelectedTasks((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next })}
                    onOpen={openTaskInspector}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </ProjectionDisclosure>

      {exerciseOccurrences.length > 0 && (
        <ProjectionDisclosure title="Workout occurrences" meta={exerciseOccurrences.length} contentClassName="full-bleed">
          <div className="exercise-occurrences">
            {exerciseOccurrences.map((occurrence) => (
              <Link
                key={`${occurrence.day}-${occurrence.exerciseTaskId}`}
                className="exercise-occurrence-row"
                to={occurrence.workoutTaskId
                  ? `/workout/${occurrence.day}/${occurrence.workoutTaskId}`
                  : `/?date=${occurrence.day}&block=${occurrence.exerciseTaskId}`}
              >
                <time>{formatDay(occurrence.day).short}</time>
                <span className="exercise-occurrence-sets">
                  {occurrence.completedSets}/{occurrence.totalSets} sets
                  {occurrence.skippedSets > 0 && ` · ${occurrence.skippedSets} skipped`}
                </span>
                <span className={`exercise-occurrence-status status-${occurrence.status}`}>
                  {occurrence.status === 'done' ? 'Completed' : occurrence.status === 'canceled' ? 'Skipped' : occurrence.status === 'in_progress' ? 'In progress' : 'Planned'}
                </span>
              </Link>
            ))}
          </div>
        </ProjectionDisclosure>
      )}

      <ProjectionDisclosure title="Current direction" meta="from your latest notes" contentClassName="full-bleed direction-content">
        <p>{direction ?? 'Keep writing. A direction will emerge as this thread grows.'}</p>
      </ProjectionDisclosure>

      <ProjectionDisclosure title="Open questions" meta={questions.length}>
        <div className="source-list">
          {questions.map((item) => <SourceRow key={item.id} icon={<HelpCircle size={15} />} {...item} />)}
          {questions.length === 0 && <div className="section-empty">No open questions</div>}
        </div>
      </ProjectionDisclosure>

      <ProjectionDisclosure title="Decisions" meta={decisions.length}>
        <div className="source-list">
          {decisions.map((item) => <SourceRow key={item.id} icon={<Quote size={15} />} {...item} />)}
          {decisions.length === 0 && <div className="section-empty">No decisions recorded yet</div>}
        </div>
      </ProjectionDisclosure>

      <ProjectionDisclosure title="Recent thoughts" meta={thoughts.length}>
        <div className="source-list">
          {thoughts.map((item) => <SourceRow key={item.id} icon={<span className="thread-dot" />} {...item} />)}
        </div>
      </ProjectionDisclosure>

      <ProjectionDisclosure title="Ideas" meta={ideas.length}>
        <div className="source-list">
          {ideas.map((item) => <SourceRow key={item.id} icon={<Lightbulb size={15} />} {...item} />)}
          {ideas.length === 0 && <div className="section-empty">No related ideas yet</div>}
        </div>
      </ProjectionDisclosure>
    </article>
  )
}

function ProjectionDisclosure({ title, meta, contentClassName, children }: { title: string; meta?: React.ReactNode; contentClassName?: string; children: React.ReactNode }) {
  return (
    <details className="projection-disclosure">
      <summary>
        <span><ChevronRight size={15} /> {title}</span>
        {meta !== undefined && <small>{meta}</small>}
      </summary>
      <div className={`projection-disclosure-content${contentClassName ? ` ${contentClassName}` : ''}`}>{children}</div>
    </details>
  )
}

function ThreadOccurrence({
  occurrence,
  blocks,
  view,
  collapseStates,
  onInspect,
}: {
  occurrence: ThreadOccurrenceRecord
  blocks: OutlineBlock[]
  view: string
  collapseStates: ViewStateRecord[]
  onInspect: (blockId: string) => void
}) {
  const navigate = useNavigate()
  const openTab = useOpenTab()
  const children = new Map<string | null, OutlineBlock[]>()
  const ids = new Set(blocks.map((block) => block.id))
  blocks.forEach((block) => {
    const parentId = block.parentId && ids.has(block.parentId) ? block.parentId : null
    const list = children.get(parentId) ?? []
    list.push(block)
    children.set(parentId, list)
  })
  const collapsed = new Map(collapseStates.map((state) => [state.blockId, state.collapsed]))

  const renderBranch = (block: OutlineBlock): React.ReactNode => {
    const descendants = children.get(block.id) ?? []
    const isCollapsed = collapsed.get(block.id) === true
    const onToggleChecked = block.kind === 'task'
      ? () => void toggleTaskByBlockId(block.id)
      : block.kind === 'checklist'
        ? () => void toggleChecklistBlock(occurrence.day, block.id)
        : null
    return (
      <li key={block.id} className={isCollapsed ? 'is-collapsed' : ''}>
        <div className="outline-row">
          {descendants.length ? (
            <button
              type="button"
              className="outline-toggle"
              aria-label={isCollapsed ? 'Expand bullet' : 'Collapse bullet'}
              aria-expanded={!isCollapsed}
              onClick={() => void db.viewState.put({
                key: `${view}:${block.id}`,
                view,
                blockId: block.id,
                collapsed: !isCollapsed,
                updatedAt: new Date().toISOString(),
              })}
            >
              <ChevronRight size={14} />
            </button>
          ) : onToggleChecked ? (
            <button
              type="button"
              className="outline-check"
              aria-label={block.checked ? 'Mark not done' : 'Mark done'}
              onClick={onToggleChecked}
            >
              {block.checked ? <CheckCircle2 size={14} /> : <Circle size={14} />}
            </button>
          ) : <span className={`outline-bullet${block.kind !== 'thought' ? ` outline-kind-${block.kind}` : ''}`}>
            {block.kind === 'idea' && <Lightbulb size={12} />}
            {block.kind === 'question' && <HelpCircle size={12} />}
            {block.kind === 'decision' && <Quote size={11} />}
          </span>}
          <span
            role="link"
            tabIndex={0}
            className={block.checked ? 'completed-block outline-text' : 'outline-text'}
            onClick={(event) => {
              const target = `/?date=${occurrence.day}&block=${block.id}`
              if (event.metaKey || event.ctrlKey) { openTab(target, { background: true }); return }
              navigate(target)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') navigate(`/?date=${occurrence.day}&block=${block.id}`)
            }}
          >
            <WikiText text={block.markdown} />
          </span>
          <button type="button" className="outline-property-button" aria-label={`Edit properties for ${block.plainText || 'block'}`} onClick={() => onInspect(block.id)}><MoreHorizontal size={14} /></button>
          {isCollapsed && <small className="collapsed-count">{countDescendants(block.id, children)}</small>}
        </div>
        {!isCollapsed && descendants.length > 0 && <ul>{descendants.map(renderBranch)}</ul>}
      </li>
    )
  }

  return (
    <div className="thread-occurrence">
      <time>{formatDay(occurrence.day).short}</time>
      <ul className="thread-outline">{(children.get(null) ?? []).map(renderBranch)}</ul>
    </div>
  )
}

function countDescendants(id: string, children: Map<string | null, OutlineBlock[]>): number {
  const direct = children.get(id) ?? []
  return direct.reduce((total, block) => total + 1 + countDescendants(block.id, children), 0)
}

function WikiText({ text }: { text: string }) {
  const display = text
    .replace(/\\(\[|\])/g, '$1')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/^\((?:\s|x|X)?\)\s+/, '')
    .replace(/^[?!=]\s+(?:\[[ xX]\]\s+)?/, '')
    .replace(/[*_~`]/g, '')
  const parts = display.split(/(\[\[[^\]]+\]\])/g)
  return <>{parts.map((part, index) => {
    const match = part.match(/^\[\[([^\]]+)\]\]$/)
    if (!match) return <span key={index}>{part}</span>
    const id = match[1].trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    return (
      <Link
        className="inline-wikilink"
        to={`/thread/${id}`}
        key={index}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="thread-dot" />{match[1]}
      </Link>
    )
  })}</>
}

function SourceRow({ day, blockId, excerpt, icon }: { day: string; blockId: string; excerpt: string; icon: React.ReactNode }) {
  return (
    <Link className="source-row" to={`/?date=${day}&block=${blockId}`}>
      <div className="source-icon">{icon}</div>
      <div><small>{formatDay(day).short}</small><p>{excerpt}</p></div>
    </Link>
  )
}
