import { useEffect, useRef, useState } from 'react'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/core'
import { trailingConfig } from '@milkdown/plugin-trailing'
import { listItemSchema } from '@milkdown/preset-commonmark'
import { liftListItem, sinkListItem } from '@milkdown/prose/schema-list'
import { TextSelection } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'
import '@milkdown/crepe/theme/common/style.css'
import { db, updateTaskMetadata, type TaskPriority, type TaskRecord } from '../db'
import { activeOutlinePathPlugin, outlinerInvariantPlugin, outlinerKeymap, semanticPrefixPlugin } from '../lib/blockKinds'
import { inlineSuggestionsPlugin } from '../lib/inlineSuggestions'
import type { BlockConversionKind } from '../lib/suggestions'
import { editorLinksToWiki, wikiLinkInputRule, wikiLinkInteractionPlugin, wikiLinksToEditor } from '../lib/wikilinks'
import { replaceAll } from '@milkdown/utils'
import { MobileEditorToolbar, type ToolbarAction, type ToolbarBlockKind } from './MobileEditorToolbar'

interface MarkdownEditorProps {
  day: string
  initialValue: string
  onChange: (markdown: string) => void
  ariaLabel?: string
  loadingLabel?: string
}

export function MarkdownEditor({ day, initialValue, onChange, ariaLabel = 'Daily journal editor', loadingLabel = 'Opening today’s page…' }: MarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  const runToolbarActionRef = useRef<(action: ToolbarAction) => void>(() => undefined)
  const [ready, setReady] = useState(false)
  const [toolbar, setToolbar] = useState({ visible: false, top: 0, activeKind: 'bullet' as ToolbarBlockKind })

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    setReady(false)

    // Keep all mutable editor state scoped to this effect instance. React
    // StrictMode intentionally mounts, tears down, and mounts effects again in
    // development; shared refs let a late event from the discarded editor
    // overwrite the live editor's value.
    let disposed = false
    let active = false
    let dirty = false
    let userMutationPending = false
    let latest = initialValue
    let saveTimer: number | null = null
    let collapseTimer: number | null = null
    let metadataTimer: number | null = null
    let activationFrame: number | null = null
    const mobileQuery = window.matchMedia('(max-width: 760px)')
    const markUserMutation = () => {
      if (active && !disposed) userMutationPending = true
    }

    const crepe = new Crepe({
      root,
      defaultValue: wikiLinksToEditor(initialValue.trim() ? initialValue : '- '),
      features: {
        [Crepe.Feature.AI]: false,
        [Crepe.Feature.ImageBlock]: false,
        [Crepe.Feature.Latex]: false,
        [Crepe.Feature.TopBar]: false,
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: 'Write what is on your mind…',
          mode: 'block',
        },
        [Crepe.Feature.LinkTooltip]: {
          inputPlaceholder: 'Paste or type a link',
        },
      },
    })
    crepe.editor.config((ctx) => {
      ctx.update(trailingConfig.key, (config) => ({
        ...config,
        shouldAppend: () => false,
      }))
    })
    crepe.editor.use(wikiLinkInputRule)
    crepe.editor.use(inlineSuggestionsPlugin({
      getThreads: async () => {
        const threads = await db.threads.orderBy('updatedAt').reverse().toArray()
        return threads.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
      },
      onMutation: markUserMutation,
      setBlockKind: setCurrentBlockKind,
    }))
    crepe.editor.use(wikiLinkInteractionPlugin)
    crepe.editor.use(semanticPrefixPlugin)
    crepe.editor.use(activeOutlinePathPlugin)
    crepe.editor.use(outlinerKeymap)
    crepe.editor.use(outlinerInvariantPlugin)
    const persist = () => {
      if (!active || disposed || !dirty) return
      dirty = false
      onChangeRef.current(latest)
    }

    const syncToolbar = () => {
      if (disposed) return
      const focused = root.contains(document.activeElement)
      const visible = mobileQuery.matches && focused
      const viewport = window.visualViewport
      const viewportBottom = viewport
        ? viewport.offsetTop + viewport.height
        : window.innerHeight
      const top = Math.max(viewport?.offsetTop ?? 0, viewportBottom - 50)
      const selectionNode = document.getSelection()?.anchorNode
      const selectionElement = selectionNode instanceof Element ? selectionNode : selectionNode?.parentElement
      const item = selectionElement && root.contains(selectionElement)
        ? selectionElement.closest<HTMLLIElement>('li')
        : null
      const text = item?.querySelector<HTMLElement>(':scope > .children > .content-dom > p:first-child')?.textContent?.trim() ?? ''
      const activeKind: ToolbarBlockKind = item?.querySelector(':scope > .label-wrapper > .label.checked, :scope > .label-wrapper > .label.unchecked')
        ? 'task'
        : /^!\s+/.test(text)
          ? 'idea'
          : /^\?\s+/.test(text)
            ? 'question'
            : /^(?:=|\\=)\s+/.test(text)
              ? 'decision'
              : 'bullet'
      document.body.classList.toggle('mobile-editor-active', visible)
      setToolbar({ visible, top, activeKind })
    }
    const syncToolbarAfterFocus = () => window.setTimeout(syncToolbar, 0)

    const markPointerMutation = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input[type="checkbox"], .label.checked, .label.unchecked')) markUserMutation()
    }
    const markKeyboardMutation = (event: KeyboardEvent) => {
      if (event.key === 'Backspace' || event.key === 'Delete') {
        markUserMutation()
        return
      }
      // Undo/redo mutate the document without passing through beforeinput, so
      // they were never marked dirty and silently failed to persist.
      const key = event.key.toLowerCase()
      if ((event.metaKey || event.ctrlKey) && (key === 'z' || key === 'y')) markUserMutation()
    }

    root.addEventListener('beforeinput', markUserMutation, true)
    root.addEventListener('paste', markUserMutation, true)
    root.addEventListener('cut', markUserMutation, true)
    root.addEventListener('drop', markUserMutation, true)
    root.addEventListener('pointerdown', markPointerMutation, true)
    root.addEventListener('keydown', markKeyboardMutation, true)

    const syncFocusedTask = () => {
      // The caret/selection position is the reliable signal for "which task
      // line is active" -- document.activeElement is the outer contenteditable
      // root itself for a ProseMirror editor, never a specific <li>, so it was
      // previously checked first and made the selection-based lookup below
      // unreachable, clearing the row on almost every focus/selection event.
      const selectionNode = document.getSelection()?.anchorNode
      const selectionElement = selectionNode instanceof Element ? selectionNode : selectionNode?.parentElement
      const active = document.activeElement
      const target = selectionElement && root.contains(selectionElement)
        ? selectionElement
        : active instanceof Element && root.contains(active) ? active : null
      const focusedTask = target?.closest<HTMLLIElement>('li.task-block') ?? null
      root.querySelectorAll('li.task-focused').forEach((item) => {
        if (item !== focusedTask) item.classList.remove('task-focused')
      })
      focusedTask?.classList.add('task-focused')
    }
    document.addEventListener('selectionchange', syncFocusedTask)
    document.addEventListener('selectionchange', syncToolbar)
    root.addEventListener('focusin', syncFocusedTask)
    root.addEventListener('focusin', syncToolbar)
    root.addEventListener('focusout', syncToolbarAfterFocus)
    window.visualViewport?.addEventListener('resize', syncToolbar)
    window.visualViewport?.addEventListener('scroll', syncToolbar)
    mobileQuery.addEventListener('change', syncToolbar)

    const openWikiLink = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#/thread/"]') : null
      if (!target) return
      event.preventDefault()
      event.stopPropagation()
      window.location.hash = target.getAttribute('href')?.slice(1) ?? '/'
    }
    root.addEventListener('click', openWikiLink, true)

    const applyExternalUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ day: string; markdown: string }>).detail
      if (disposed || detail?.day !== day) return
      latest = detail.markdown
      dirty = false
      userMutationPending = false
      crepe.editor.action(replaceAll(wikiLinksToEditor(detail.markdown.trim() ? detail.markdown : '- ')))
      if (metadataTimer) window.clearTimeout(metadataTimer)
      metadataTimer = window.setTimeout(() => {
        if (disposed) return
        void installCollapseControls(root, day)
        crepe.editor.action((ctx) => {
          void installTaskControls(ctx.get(editorViewCtx), day)
        })
      }, 120)
    }
    window.addEventListener('thread:day-external-update', applyExternalUpdate)

    runToolbarActionRef.current = (action) => {
      markUserMutation()
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const listItemType = listItemSchema.type(ctx)
        if (action === 'indent') {
          sinkListItem(listItemType)(view.state, view.dispatch)
        } else if (action === 'outdent') {
          liftListItem(listItemType)(view.state, view.dispatch)
        } else if (action === 'wikilink') {
          const { from, to } = view.state.selection
          const transaction = view.state.tr.insertText('[[]]', from, to)
          transaction.setSelection(TextSelection.create(transaction.doc, from + 2))
          view.dispatch(transaction)
        } else {
          setCurrentBlockKind(view, action)
        }
        view.focus()
        window.requestAnimationFrame(syncToolbar)
      })
    }

    crepe.on((listener) => {
      listener.markdownUpdated((ctx, markdown, previous) => {
        // Milkdown can emit updates while it is hydrating or being destroyed.
        // Only an active editor is allowed to write to the journal.
        if (!active || disposed || markdown === previous || !userMutationPending) return
        userMutationPending = false
        const canonical = editorLinksToWiki(markdown)
        if (canonical === latest) return
        latest = canonical
        dirty = true
        if (saveTimer) window.clearTimeout(saveTimer)
        saveTimer = window.setTimeout(persist, 180)
        if (collapseTimer) window.clearTimeout(collapseTimer)
        collapseTimer = window.setTimeout(() => {
          if (!disposed) void installCollapseControls(root, day)
        }, 0)
        // Walk the live document in the same tick the transaction landed, so
        // the DOM node and its identity always come from the same node --
        // never a DOM query zipped against a separately fetched list.
        void installTaskControls(ctx.get(editorViewCtx), day)
      })
      listener.blur(() => {
        if (saveTimer) window.clearTimeout(saveTimer)
        persist()
      })
    })

    void crepe.create().then(() => {
      if (disposed) {
        void crepe.destroy()
        return
      }
      setReady(true)
      void installCollapseControls(root, day)
      crepe.editor.action((ctx) => {
        void installTaskControls(ctx.get(editorViewCtx), day)
      })
      // Let initialization events drain before accepting editor writes.
      activationFrame = window.requestAnimationFrame(() => {
        if (!disposed) active = true
      })
    })

    return () => {
      // Capture a genuine pending user edit, then make the instance inert
      // before destroying Milkdown so teardown events cannot persist data.
      const pendingUserEdit = active && dirty ? latest : null
      disposed = true
      active = false
      if (saveTimer) window.clearTimeout(saveTimer)
      if (collapseTimer) window.clearTimeout(collapseTimer)
      if (metadataTimer) window.clearTimeout(metadataTimer)
      if (activationFrame) window.cancelAnimationFrame(activationFrame)
      if (pendingUserEdit !== null) onChangeRef.current(pendingUserEdit)
      root.removeEventListener('beforeinput', markUserMutation, true)
      root.removeEventListener('paste', markUserMutation, true)
      root.removeEventListener('cut', markUserMutation, true)
      root.removeEventListener('drop', markUserMutation, true)
      root.removeEventListener('pointerdown', markPointerMutation, true)
      root.removeEventListener('keydown', markKeyboardMutation, true)
      document.removeEventListener('selectionchange', syncFocusedTask)
      document.removeEventListener('selectionchange', syncToolbar)
      root.removeEventListener('focusin', syncFocusedTask)
      root.removeEventListener('focusin', syncToolbar)
      root.removeEventListener('focusout', syncToolbarAfterFocus)
      window.visualViewport?.removeEventListener('resize', syncToolbar)
      window.visualViewport?.removeEventListener('scroll', syncToolbar)
      mobileQuery.removeEventListener('change', syncToolbar)
      root.removeEventListener('click', openWikiLink, true)
      window.removeEventListener('thread:day-external-update', applyExternalUpdate)
      runToolbarActionRef.current = () => undefined
      document.body.classList.remove('mobile-editor-active')
      void crepe.destroy()
      root.replaceChildren()
    }
    // The editor is intentionally recreated only when the journal day changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day])

  return (
    <div className="editor-wrap" data-ready={ready}>
      {!ready && <div className="editor-loading">{loadingLabel}</div>}
      <div ref={rootRef} className="thread-editor" aria-label={ariaLabel} />
      <MobileEditorToolbar
        visible={toolbar.visible}
        top={toolbar.top}
        activeKind={toolbar.activeKind}
        onAction={(action) => runToolbarActionRef.current(action)}
      />
    </div>
  )
}

function setCurrentBlockKind(
  view: EditorView,
  kind: BlockConversionKind,
  replaceRange?: { from: number; to: number },
): void {
  const { state } = view
  let transaction = state.tr
  if (replaceRange) {
    transaction = transaction.delete(replaceRange.from, replaceRange.to)
    transaction = transaction.setSelection(TextSelection.near(transaction.doc.resolve(replaceRange.from)))
  }
  const { $from } = transaction.selection
  let itemDepth = $from.depth
  while (itemDepth > 0 && $from.node(itemDepth).type.name !== 'list_item') itemDepth -= 1
  if (itemDepth === 0) return

  let paragraphDepth = $from.depth
  while (paragraphDepth > itemDepth && $from.node(paragraphDepth).type.name !== 'paragraph') paragraphDepth -= 1
  if (paragraphDepth <= itemDepth) return

  const item = $from.node(itemDepth)
  const itemPosition = $from.before(itemDepth)
  const paragraph = $from.node(paragraphDepth)
  const paragraphStart = $from.start(paragraphDepth)
  const existingPrefix = paragraph.textContent.match(/^(?:\?|=|\\=|!)\s+/)?.[0]
  const desiredPrefix = kind === 'idea' ? '! ' : kind === 'question' ? '? ' : kind === 'decision' ? '= ' : null
  const existingKind = existingPrefix?.trim().replace('\\=', '=')
  const desiredKind = desiredPrefix?.trim()
  if (existingPrefix) transaction = transaction.delete(paragraphStart, paragraphStart + existingPrefix.length)

  if (kind === 'task') {
    transaction = transaction.setNodeMarkup(itemPosition, undefined, {
      ...item.attrs,
      checked: item.attrs.checked == null ? false : null,
    })
  } else {
    if (item.attrs.checked != null) {
      transaction = transaction.setNodeMarkup(itemPosition, undefined, { ...item.attrs, checked: null })
    }
    if (desiredPrefix && existingKind !== desiredKind) transaction = transaction.insertText(desiredPrefix, paragraphStart)
  }

  view.dispatch(transaction)
}

interface LiveTaskNode {
  id: string
  dom: HTMLElement
  checked: boolean
}

// Walk the live ProseMirror document -- not a separately queried DOM list, not
// a separately fetched DB array -- and read each task's identity and its DOM
// element off the very same node in the very same pass. Two lists derived at
// different times (or from different sources) can drift out of step with each
// other; a single node can't drift out of step with itself.
function collectTaskNodes(view: EditorView, day: string): LiveTaskNode[] {
  const results: LiveTaskNode[] = []
  const pathStack: Array<{ path: string; nextIndex: number }> = [{ path: '', nextIndex: 0 }]

  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'list_item') return true

    let itemDepth = 0
    const resolved = view.state.doc.resolve(pos)
    for (let depth = 1; depth <= resolved.depth; depth += 1) {
      if (resolved.node(depth).type.name === 'list_item') itemDepth += 1
    }

    // Mirrors the indentation-based path Thread's markdown parser assigns to
    // the same block (see parseOutline in lib/outline.ts), so a task's DOM
    // node and its persisted TaskRecord always resolve to the same id.
    while (pathStack.length > itemDepth + 1) pathStack.pop()
    const level = pathStack[itemDepth]
    const index = level.nextIndex
    level.nextIndex += 1
    const path = level.path ? `${level.path}.${index}` : `${index}`
    pathStack[itemDepth + 1] = { path, nextIndex: 0 }

    if (typeof node.attrs.checked === 'boolean') {
      // Crepe's list-item node view registers a wrapper div as the node's DOM
      // root; the actual <li> we render controls onto is that wrapper's
      // direct child.
      const wrapper = view.nodeDOM(pos)
      const dom = wrapper instanceof HTMLElement ? wrapper.querySelector<HTMLElement>(':scope > li') ?? wrapper : null
      if (dom instanceof HTMLElement) results.push({ id: `${day}:${path}`, dom, checked: node.attrs.checked })
    }
    return true
  })

  return results
}

async function installTaskControls(view: EditorView, day: string): Promise<void> {
  const nodes = collectTaskNodes(view, day)

  await Promise.all(nodes.map(async ({ id, dom: item, checked }) => {
    item.classList.add('task-block')
    item.dataset.taskId = id

    const persisted = await db.tasks.get(id)
    const task: TaskRecord = persisted ?? {
      id,
      blockId: id,
      day,
      line: 0,
      order: 0,
      text: item.textContent ?? '',
      checked,
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
      row.innerHTML = '<label><span>Due</span><input class="task-due-input" type="date" aria-label="Task due date"></label><label><span>Priority</span><select class="task-priority-input" aria-label="Task priority"><option value="">Add priority</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>'
      children.append(row)
    }

    const dueInput = row.querySelector<HTMLInputElement>('.task-due-input')!
    const priorityInput = row.querySelector<HTMLSelectElement>('.task-priority-input')!
    dueInput.value = task.dueDate ?? ''
    priorityInput.value = task.priority ?? ''
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
  }))
}

function renderTaskChips(container: HTMLElement, task: TaskRecord): void {
  container.replaceChildren()
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

async function installCollapseControls(root: HTMLElement, day: string): Promise<void> {
  const view = `today:${day}`
  const states = await db.viewState.where('view').equals(view).toArray()
  const collapsed = new Map(states.map((state) => [state.blockId, state.collapsed]))
  const items = Array.from(root.querySelectorAll<HTMLLIElement>('.ProseMirror li'))

  items.forEach((item, index) => {
    const childList = item.querySelector(':scope > .children > .content-dom > ul, :scope > .children > .content-dom > ol')
    const label = item.querySelector<HTMLElement>(':scope > .label-wrapper')
    const existing = label?.querySelector<HTMLButtonElement>(':scope > .collapse-toggle')
    if (!childList) {
      existing?.remove()
      return
    }

    const blockId = `${day}:editor:${index}`
    const button = existing ?? document.createElement('button')
    button.type = 'button'
    button.className = 'collapse-toggle'
    button.contentEditable = 'false'
    button.tabIndex = 0
    button.setAttribute('aria-label', 'Collapse bullet')
    button.setAttribute('title', 'Collapse bullet')
    button.textContent = '›'
    item.classList.toggle('thread-collapsed', collapsed.get(blockId) === true)
    button.setAttribute('aria-expanded', String(!item.classList.contains('thread-collapsed')))

    if (!existing && label) label.append(button)
    button.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
      const next = !item.classList.contains('thread-collapsed')
      item.classList.toggle('thread-collapsed', next)
      button.setAttribute('aria-expanded', String(!next))
      void db.viewState.put({
        key: `${view}:${blockId}`,
        view,
        blockId,
        collapsed: next,
        updatedAt: new Date().toISOString(),
      })
    }
  })
  installBlockKindControls(root)
}

function installBlockKindControls(root: HTMLElement): void {
  const kinds = [
    { className: 'kind-question', pattern: /^\?\s+/, label: 'Question' },
    { className: 'kind-decision', pattern: /^(?:=|\\=)\s+/, label: 'Decision' },
    { className: 'kind-idea', pattern: /^!\s+/, label: 'Idea' },
  ] as const

  root.querySelectorAll<HTMLLIElement>('.ProseMirror li').forEach((item) => {
    item.classList.remove('kind-block', ...kinds.map((kind) => kind.className))
    item.removeAttribute('data-kind-label')

    if (item.classList.contains('task-block')) return
    const paragraph = item.querySelector<HTMLElement>(':scope > .children > .content-dom > p:first-child')
    const content = paragraph?.textContent?.trim() ?? ''
    const kind = kinds.find((candidate) => candidate.pattern.test(content))
    if (!kind) return

    item.classList.add('kind-block', kind.className)
    item.dataset.kindLabel = kind.label
  })
}
