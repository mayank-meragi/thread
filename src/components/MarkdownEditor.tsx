import { useEffect, useRef, useState } from 'react'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/core'
import { trailingConfig } from '@milkdown/plugin-trailing'
import { listItemSchema } from '@milkdown/preset-commonmark'
import type { Node as ProseNode } from '@milkdown/prose/model'
import { liftListItem, sinkListItem } from '@milkdown/prose/schema-list'
import { TextSelection } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'
import '@milkdown/crepe/theme/common/style.css'
import { db } from '../db'
import {
  activeOutlinePathPlugin,
  checklistCheckedPattern,
  checklistPrefixPattern,
  clearTaskExtras,
  detectPrefixKind,
  getBlockKindDefinition,
  mountTaskExtras,
  outlinerInvariantPlugin,
  outlinerKeymap,
  prefixedBlockKinds,
  semanticPrefixPlugin,
} from '../lib/blockKinds'
import { inlineSuggestionsPlugin } from '../lib/inlineSuggestions'
import { parseOutline } from '../lib/outline'
import type { BlockConversionKind } from '../lib/suggestions'
import { editorLinksToWiki, wikiLinkInputRule, wikiLinkInteractionPlugin, wikiLinksToEditor } from '../lib/wikilinks'
import { editorLinksToTags, tagLinkInputRule, tagLinksToEditor } from '../lib/taglinks'
import { replaceAll } from '@milkdown/utils'
import { MobileEditorToolbar, type ToolbarAction, type ToolbarBlockKind } from './MobileEditorToolbar'
import { BlockInspector } from './BlockInspector'

interface MarkdownEditorProps {
  day: string
  initialValue: string
  onChange: (markdown: string) => void
  onReady?: () => void
  ariaLabel?: string
  loadingLabel?: string
}

export function MarkdownEditor({ day, initialValue, onChange, onReady, ariaLabel = 'Daily journal editor', loadingLabel = 'Opening today’s page…' }: MarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  const onReadyRef = useRef(onReady)
  const runToolbarActionRef = useRef<(action: ToolbarAction) => void>(() => undefined)
  const [ready, setReady] = useState(false)
  const [toolbar, setToolbar] = useState({ visible: false, top: 0, activeKind: 'bullet' as ToolbarBlockKind })
  const [inspectorBlockId, setInspectorBlockId] = useState<string | null>(null)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

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
      defaultValue: tagLinksToEditor(wikiLinksToEditor(initialValue.trim() ? initialValue : '- ')),
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
    crepe.editor.use(tagLinkInputRule)
    crepe.editor.use(inlineSuggestionsPlugin({
      getThreads: async () => {
        const threads = await db.threads.orderBy('updatedAt').reverse().toArray()
        return threads.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
      },
      getTags: async () => {
        const tags = await db.tagDefinitions.orderBy('name').toArray()
        return tags.map(({ id, name, color, propertyIds }) => ({ id, name, color, propertyCount: propertyIds.length }))
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
        : detectPrefixKind(text)?.id ?? 'bullet'
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

    // Crepe's own label-wrapper pointerdown handler stops propagation
    // unconditionally (even for non-task bullets), so this has to run in the
    // capture phase on `root` to see the event first.
    const toggleChecklistItem = (event: PointerEvent) => {
      const item = event.target instanceof Element
        ? event.target.closest<HTMLLIElement>('li.kind-checklist > .label-wrapper > .label.bullet')?.closest<HTMLLIElement>('li.kind-checklist')
        : null
      if (!item) return
      event.preventDefault()
      event.stopPropagation()
      markUserMutation()
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        let match: { pos: number; paragraph: ProseNode } | null = null
        view.state.doc.descendants((node, pos) => {
          if (match || node.type.name !== 'list_item') return true
          const wrapper = view.nodeDOM(pos)
          const dom = wrapper instanceof HTMLElement ? wrapper.querySelector<HTMLElement>(':scope > li') ?? wrapper : null
          if (dom === item && node.firstChild?.type.name === 'paragraph') match = { pos, paragraph: node.firstChild }
          return true
        })
        if (!match) return
        // TS narrows `match` to `never` here because the reassignment happens
        // inside the descendants() closure, which its control-flow analysis
        // doesn't see as affecting this outer scope. An explicit annotation
        // on a fresh binding sidesteps that -- `never` is assignable to
        // anything, so this just recovers the real type.
        const found: { pos: number; paragraph: ProseNode } = match
        const paragraphStart = found.pos + 2
        const prefixMatch = found.paragraph.textContent.match(checklistPrefixPattern)?.[0]
        if (!prefixMatch) return
        const checked = checklistCheckedPattern.test(prefixMatch)
        const replacement = checked ? '() ' : '(x) '
        view.dispatch(view.state.tr.insertText(replacement, paragraphStart, paragraphStart + prefixMatch.length))
        view.focus()
      })
    }
    root.addEventListener('pointerdown', toggleChecklistItem, true)

    const applyExternalUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ day: string; markdown: string }>).detail
      if (disposed || detail?.day !== day) return
      // Never replace the document while there's a keystroke not yet folded
      // into `latest` (userMutationPending) or content computed but not yet
      // handed off to onChange (dirty). A background update -- most commonly
      // a remote pull racing with active typing -- must not blow away what
      // the user is mid-way through typing; it'll be reflected next time an
      // external update arrives once the user pauses.
      if (userMutationPending || dirty) return
      latest = detail.markdown
      dirty = false
      userMutationPending = false
      crepe.editor.action(replaceAll(tagLinksToEditor(wikiLinksToEditor(detail.markdown.trim() ? detail.markdown : '- '))))
      if (metadataTimer) window.clearTimeout(metadataTimer)
      metadataTimer = window.setTimeout(() => {
        if (disposed) return
        void installCollapseControls(root, day)
        crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          void installTaskControls(view, day, detail.markdown)
          void installBlockMetadataControls(view, day, setInspectorBlockId)
        })
      }, 120)
    }
    window.addEventListener('thread:day-external-update', applyExternalUpdate)

    const refreshBlockMetadata = (event: Event) => {
      const detail = (event as CustomEvent<{ day: string }>).detail
      if (disposed || detail?.day !== day) return
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        void installTaskControls(view, day, latest)
        void installBlockMetadataControls(view, day, setInspectorBlockId)
      })
    }
    window.addEventListener('thread:block-metadata-update', refreshBlockMetadata)

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
        const canonical = editorLinksToTags(editorLinksToWiki(markdown))
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
        const view = ctx.get(editorViewCtx)
        void installTaskControls(view, day, canonical)
        window.setTimeout(() => {
          if (!disposed) void installBlockMetadataControls(view, day, setInspectorBlockId)
        }, 240)
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
        const view = ctx.get(editorViewCtx)
        void installBlockMetadataControls(view, day, setInspectorBlockId)
        void installTaskControls(view, day, latest).then(() => onReadyRef.current?.())
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
      root.removeEventListener('pointerdown', toggleChecklistItem, true)
      window.removeEventListener('thread:day-external-update', applyExternalUpdate)
      window.removeEventListener('thread:block-metadata-update', refreshBlockMetadata)
      runToolbarActionRef.current = () => undefined
      document.body.classList.remove('mobile-editor-active')
      void crepe.destroy()
      root.replaceChildren()
    }
    // The editor is intentionally recreated only when the journal day changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day])

  return (<>
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
      <BlockInspector blockId={inspectorBlockId} onClose={() => setInspectorBlockId(null)} />
    </>
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
  const existingKind = detectPrefixKind(paragraph.textContent)
  const existingPrefixMatch = existingKind?.prefixPattern.exec(paragraph.textContent)?.[0]
  const definition = getBlockKindDefinition(kind)
  if (existingPrefixMatch) transaction = transaction.delete(paragraphStart, paragraphStart + existingPrefixMatch.length)

  if (definition?.isTask) {
    transaction = transaction.setNodeMarkup(itemPosition, undefined, {
      ...item.attrs,
      checked: item.attrs.checked == null ? false : null,
    })
  } else {
    if (item.attrs.checked != null) {
      transaction = transaction.setNodeMarkup(itemPosition, undefined, { ...item.attrs, checked: null })
    }
    if (definition?.prefixText && existingKind?.id !== kind) transaction = transaction.insertText(definition.prefixText, paragraphStart)
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
//
// The block-id path scheme (day:0.1.2, following indentation nesting) has one
// canonical implementation: parseOutline in lib/outline.ts, which is also
// what produces the TaskRecord ids stored in Dexie. Re-deriving that same
// scheme here from the live ProseMirror tree would mean two algorithms have
// to stay in lockstep forever; instead we pair each live task DOM node with
// its parsed block purely by shared document order -- both are walked from
// the same markdown snapshot in the same synchronous pass, so their order and
// count always agree.
function collectTaskNodes(view: EditorView, day: string, markdown: string): LiveTaskNode[] {
  const domNodes: HTMLElement[] = []
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'list_item' || typeof node.attrs.checked !== 'boolean') return true
    // Crepe's list-item node view registers a wrapper div as the node's DOM
    // root; the actual <li> we render controls onto is that wrapper's direct
    // child.
    const wrapper = view.nodeDOM(pos)
    const dom = wrapper instanceof HTMLElement ? wrapper.querySelector<HTMLElement>(':scope > li') ?? wrapper : null
    if (dom instanceof HTMLElement) domNodes.push(dom)
    return true
  })

  const taskBlocks = parseOutline(markdown, day).blocks.filter((block) => block.kind === 'task')
  // A mismatch means the document has already moved on from this markdown
  // snapshot by the time this ran -- skip rather than risk pairing the wrong
  // id with the wrong DOM node. The next scheduled pass retries.
  if (domNodes.length !== taskBlocks.length) return []

  return domNodes.map((dom, index) => ({ id: taskBlocks[index].id, dom, checked: taskBlocks[index].checked }))
}

// Same document-order pairing trick as collectTaskNodes, but unfiltered --
// every list item gets tagged with its stable block id, not just tasks. This
// is what lets other pages (e.g. TodayPage jumping to a source line) find a
// specific block's DOM node with a plain `[data-block-id]` selector.
async function installBlockMetadataControls(view: EditorView, day: string, onOpen: (blockId: string) => void): Promise<void> {
  const domNodes: HTMLElement[] = []
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'list_item') return true
    const wrapper = view.nodeDOM(pos)
    const dom = wrapper instanceof HTMLElement ? wrapper.querySelector<HTMLElement>(':scope > li') ?? wrapper : null
    if (dom instanceof HTMLElement) domNodes.push(dom)
    return true
  })
  const blocks = await db.blocks.where('day').equals(day).sortBy('order')
  if (domNodes.length !== blocks.length) return
  domNodes.forEach((dom, index) => {
    const blockId = blocks[index].id
    dom.dataset.blockId = blockId
    let button = dom.querySelector<HTMLButtonElement>(':scope > .block-property-trigger')
    if (!button) {
      button = document.createElement('button')
      button.type = 'button'
      button.className = 'block-property-trigger'
      button.contentEditable = 'false'
      button.textContent = '···'
      dom.append(button)
    }
    button.setAttribute('aria-label', `Edit properties for ${blocks[index].plainText || 'block'}`)
    button.title = 'Block properties'
    button.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
      onOpen(blockId)
    }
  })
}

// Task is the only kind today with extra per-block DOM (chips, a due/priority
// edit row); mountTaskExtras/clearTaskExtras (lib/blockKinds/taskExtras.ts)
// own that rendering entirely. This function's job is just: figure out which
// <li> is a task right now and hand it off -- a future kind with its own
// extra fields plugs in the same way, without touching this tree-walk.
async function installTaskControls(view: EditorView, day: string, markdown: string): Promise<void> {
  const nodes = collectTaskNodes(view, day, markdown)

  // A block that stops being a task (e.g. converted to a question/decision/
  // idea via the slash command) still carries the classes and DOM controls
  // this function previously only ever added. The shared styling pass
  // permanently skips anything still marked task-block, so without this
  // cleanup the block would never render its new kind for the rest of the
  // session.
  const activeDom = new Set(nodes.map((node) => node.dom))
  view.dom.querySelectorAll<HTMLElement>('li.task-block').forEach((item) => {
    if (!activeDom.has(item)) clearTaskExtras(item)
  })

  await Promise.all(nodes.map(async ({ id, dom: item, checked }) => {
    item.classList.add('task-block')
    item.dataset.taskId = id
    await mountTaskExtras(item, id, day, checked)
  }))
}

// Collapse toggles and question/decision/idea styling both need one pass over
// every list item; walking the tree twice (once per concern) doubles DOM
// query cost on every edit for no benefit, so they're combined here.
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
    } else {
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
    }

    item.classList.remove('kind-block', 'kind-checklist-checked', ...prefixedBlockKinds.map((kind) => kind.className))
    item.removeAttribute('data-kind-label')
    if (item.classList.contains('task-block')) return
    const paragraph = item.querySelector<HTMLElement>(':scope > .children > .content-dom > p:first-child')
    const content = paragraph?.textContent?.trim() ?? ''
    const kind = prefixedBlockKinds.find((candidate) => candidate.prefixPattern.test(content))
    if (!kind) return
    item.classList.add('kind-block', kind.className)
    item.dataset.kindLabel = kind.label
    if (kind.id === 'checklist') {
      const prefix = content.match(checklistPrefixPattern)?.[0] ?? ''
      item.classList.toggle('kind-checklist-checked', checklistCheckedPattern.test(prefix))
    }
  })
}
