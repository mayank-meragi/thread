import { Plugin, TextSelection, type Command } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import { $prose, $useKeymap } from '@milkdown/utils'

const SEMANTIC_PREFIX = /^(?:\?|=|\\=|!)\s+/

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

export const outlinerKeymap = $useKeymap('threadOutlinerKeymap', {
  OutlinerBackspace: {
    shortcuts: 'Backspace',
    priority: 100,
    command: () => handleOutlinerBackspace,
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
