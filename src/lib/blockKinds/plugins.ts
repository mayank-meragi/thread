import { NodeSelection, Plugin, TextSelection, type Command } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import { $prose, $useKeymap } from '@milkdown/utils'
import { semanticPrefixRegex as SEMANTIC_PREFIX } from './definitions'

export const semanticPrefixPlugin = $prose(() => new Plugin({
  props: {
    decorations(state) {
      const decorations: Decoration[] = []

      state.doc.descendants((node, position, parent) => {
        if (node.type.name !== 'paragraph' || parent?.type.name !== 'list_item') return
        const prefix = node.textContent.match(SEMANTIC_PREFIX)?.[0]
        if (!prefix) return

        const from = position + 1
        const to = from + prefix.length
        const cursorIsEditingPrefix = state.selection.from >= from && state.selection.from <= to
        const hasVisibleContent = node.textContent.length > prefix.length
        if (cursorIsEditingPrefix || !hasVisibleContent) return

        decorations.push(Decoration.inline(from, to, {
          class: 'semantic-prefix',
          'aria-hidden': 'true',
        }, {
          inclusiveStart: false,
          inclusiveEnd: false,
        }))
      })

      return DecorationSet.create(state.doc, decorations)
    },
  },
}))

export const activeOutlinePathPlugin = $prose(() => new Plugin({
  view(editorView) {
    const syncPath = () => {
      editorView.dom.querySelectorAll('.is-active-path, .is-active-node').forEach((element) => {
        element.classList.remove('is-active-path', 'is-active-node')
      })

      const { $from } = editorView.state.selection
      const itemDepths: number[] = []
      for (let depth = 1; depth <= $from.depth; depth += 1) {
        if ($from.node(depth).type.name === 'list_item') itemDepths.push(depth)
      }

      itemDepths.forEach((depth, index) => {
        const nodeView = editorView.nodeDOM($from.before(depth))
        if (!(nodeView instanceof HTMLElement)) return
        const element = nodeView.matches('li')
          ? nodeView
          : nodeView.querySelector<HTMLElement>(':scope > li.list-item')
        if (!element) return
        element.classList.add('is-active-path')
        if (index === itemDepths.length - 1) element.classList.add('is-active-node')
      })
    }

    syncPath()
    return {
      update: syncPath,
      destroy() {
        editorView.dom.querySelectorAll('.is-active-path, .is-active-node').forEach((element) => {
          element.classList.remove('is-active-path', 'is-active-node')
        })
      },
    }
  },
}))

const handleOutlinerBackspace: Command = (state, dispatch) => {
  const { selection } = state
  if (!(selection instanceof TextSelection) || !selection.empty) return false

  const { $from } = selection
  const semanticPrefix = $from.parent.textContent.match(SEMANTIC_PREFIX)?.[0]
  if (semanticPrefix && $from.parentOffset === semanticPrefix.length) {
    const paragraphStart = $from.start()
    dispatch?.(state.tr.delete(paragraphStart, paragraphStart + semanticPrefix.length))
    return true
  }
  if ($from.parentOffset !== 0) return false

  let itemDepth = $from.depth - 1
  while (itemDepth > 0 && $from.node(itemDepth).type.name !== 'list_item') itemDepth--
  if (itemDepth === 0) return false

  const item = $from.node(itemDepth)
  const itemPosition = $from.before(itemDepth)
  if (item.attrs.checked != null) {
    dispatch?.(state.tr.setNodeMarkup(itemPosition, undefined, { ...item.attrs, checked: null }))
    return true
  }

  if ($from.parent.content.size !== 0) {
    const listDepth = itemDepth - 1
    const isFirstTopLevelItem = listDepth > 0
      && $from.index(listDepth) === 0
      && $from.node(listDepth - 1).type.name === 'doc'
    return isFirstTopLevelItem
  }

  const list = $from.node(itemDepth - 1)
  if (list.childCount === 1) return true

  dispatch?.(state.tr.delete(itemPosition, itemPosition + item.nodeSize))
  return true
}

// Mod-a escalates one level per press instead of jumping straight to
// everything: the current bullet first, then that bullet's parent (with all
// its children), and so on up to the whole outline -- mirroring how most
// outliner apps (Notion, Workflowy) scope select-all to where your cursor is.
const selectHierarchy: Command = (state, dispatch) => {
  const { doc, selection } = state

  if (selection instanceof NodeSelection && selection.node.type.name === 'list_item') {
    // $from resolves to the position right before this node, so its depth is
    // the depth of the node's own parent (the bullet_list it lives in) --
    // one less than the item's own depth. Each list_item -> bullet_list ->
    // list_item nesting step is two depth levels, so the parent item (if
    // any) sits two levels up from this item's own depth.
    const itemDepth = selection.$from.depth + 1
    const parentItemDepth = itemDepth - 2
    if (parentItemDepth >= 1 && selection.$from.node(parentItemDepth).type.name === 'list_item') {
      dispatch?.(state.tr.setSelection(NodeSelection.create(doc, selection.$from.before(parentItemDepth))))
      return true
    }
    // No more ancestor bullets -- select the entire outline.
    dispatch?.(state.tr.setSelection(TextSelection.create(doc, 0, doc.content.size)))
    return true
  }

  const $anchor = selection.$anchor
  let itemDepth = $anchor.depth
  while (itemDepth > 0 && $anchor.node(itemDepth).type.name !== 'list_item') itemDepth -= 1
  if (itemDepth === 0) return false
  dispatch?.(state.tr.setSelection(NodeSelection.create(doc, $anchor.before(itemDepth))))
  return true
}

export const outlinerKeymap = $useKeymap('threadOutlinerKeymap', {
  OutlinerBackspace: {
    shortcuts: 'Backspace',
    priority: 100,
    command: () => handleOutlinerBackspace,
  },
  SelectHierarchy: {
    shortcuts: 'Mod-a',
    priority: 100,
    command: () => selectHierarchy,
  },
})

export const outlinerInvariantPlugin = $prose(() => new Plugin({
  appendTransaction(_transactions, _oldState, state) {
    const { doc, schema } = state
    const onlyNode = doc.childCount === 1 ? doc.firstChild : null
    if (!onlyNode || onlyNode.type.name !== 'paragraph' || onlyNode.content.size !== 0) return null

    const paragraph = schema.nodes.paragraph
    const listItem = schema.nodes.list_item
    const bulletList = schema.nodes.bullet_list
    if (!paragraph || !listItem || !bulletList) return null

    const outline = bulletList.create(null, listItem.create(null, paragraph.create()))
    const transaction = state.tr.replaceWith(0, doc.content.size, outline)
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(3)))
    return transaction
  },
}))
