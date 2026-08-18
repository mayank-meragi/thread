import { InputRule } from '@milkdown/prose/inputrules'
import { linkSchema } from '@milkdown/preset-commonmark'
import { Plugin, TextSelection } from '@milkdown/prose/state'
import type { EditorState, Transaction } from '@milkdown/prose/state'
import { $inputRule, $prose } from '@milkdown/utils'
import { slugifyThread } from './outline'

const WIKI_TITLE = 'thread-wikilink'

export function wikiLinksToEditor(markdown: string): string {
  const unescaped = markdown.replace(/\\(\[|\])/g, '$1')
  return unescaped.replace(/\[\[([^\]]+)\]\]/g, (_match, rawTitle: string) => {
    const title = rawTitle.trim()
    const threadId = slugifyThread(title)
    return threadId ? `[${title}](#/thread/${threadId} "${WIKI_TITLE}")` : _match
  })
}

export function editorLinksToWiki(markdown: string): string {
  return markdown.replace(
    /\[([^\]]+)\]\(#\/thread\/[^\s)]+(?:\s+["']thread-wikilink["'])?\)/g,
    '[[$1]]',
  ).replace(/\\\[\\\[([^\]]+)\\\]\\\]/g, '[[$1]]')
}

export const wikiLinkInputRule = $inputRule((ctx) => new InputRule(
  /\[\[([^\]]+)\]\]$/,
  (state, match, start, end) => {
    const title = match[1].trim()
    const threadId = slugifyThread(title)
    if (!threadId) return null
    const mark = linkSchema.type(ctx).create({ href: `#/thread/${threadId}`, title: WIKI_TITLE })
    return state.tr.replaceWith(start, end, state.schema.text(title, [mark]))
  },
))

interface WikiDraft {
  from: number
  to: number
  title: string
}

function findWikiDraft(state: EditorState, cursor: number): WikiDraft | null {
  const $cursor = state.doc.resolve(cursor)
  if (!$cursor.parent.isTextblock) return null
  const before = $cursor.parent.textBetween(0, $cursor.parentOffset, undefined, '\ufffc')
  const after = $cursor.parent.textBetween($cursor.parentOffset, $cursor.parent.content.size, undefined, '\ufffc')
  const match = before.match(/\[\[([^]+)$/)
  if (!match || match[1].includes('[') || match[1].includes(']') || !after.startsWith(']]')) return null
  const title = match[1].trim()
  if (!slugifyThread(title)) return null
  return {
    from: $cursor.start() + before.length - match[0].length,
    to: cursor + 2,
    title,
  }
}

function acceptWikiDraft(
  state: EditorState,
  draft: WikiDraft,
  linkType: ReturnType<typeof linkSchema.type>,
): Transaction {
  const threadId = slugifyThread(draft.title)
  const mark = linkType.create({ href: `#/thread/${threadId}`, title: WIKI_TITLE })
  const transaction = state.tr.replaceWith(
    draft.from,
    draft.to,
    state.schema.text(draft.title, [mark]),
  )
  transaction.setSelection(TextSelection.create(transaction.doc, draft.from + draft.title.length))
  transaction.setStoredMarks([])
  return transaction
}

export const wikiLinkInteractionPlugin = $prose((ctx) => {
  const linkType = linkSchema.type(ctx)
  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        if (text === '[' && from === to) {
          const $from = view.state.doc.resolve(from)
          const previous = $from.parentOffset > 0
            ? $from.parent.textBetween($from.parentOffset - 1, $from.parentOffset)
            : ''
          if (previous === '[') {
            const transaction = view.state.tr.insertText('[]]', from, to)
            transaction.setSelection(TextSelection.create(transaction.doc, from + 1))
            view.dispatch(transaction)
            return true
          }
        }

        if (text === ']') {
          const draft = findWikiDraft(view.state, from)
          if (draft) {
            view.dispatch(acceptWikiDraft(view.state, draft, linkType))
            return true
          }
        }
        return false
      },
      handleKeyDown(view, event) {
        if (event.key === '[' && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const { selection } = view.state
          if (selection instanceof TextSelection && selection.empty) {
            const $from = view.state.doc.resolve(selection.from)
            const previous = $from.parentOffset > 0
              ? $from.parent.textBetween($from.parentOffset - 1, $from.parentOffset)
              : ''
            if (previous === '[') {
              event.preventDefault()
              const transaction = view.state.tr.insertText('[]]', selection.from)
              transaction.setSelection(TextSelection.create(transaction.doc, selection.from + 1))
              view.dispatch(transaction)
              return true
            }
          }
        }

        if (event.key !== 'ArrowRight' && event.key !== 'Tab') return false
        const { selection } = view.state
        if (!(selection instanceof TextSelection) || !selection.empty) return false
        const draft = findWikiDraft(view.state, selection.from)
        if (!draft) return false
        event.preventDefault()
        view.dispatch(acceptWikiDraft(view.state, draft, linkType))
        return true
      },
      handleClick(view, position, event) {
        if (event.shiftKey) return false
        const target = event.target instanceof Element ? event.target : null
        if (target?.closest('a[href^="#/thread/"]')) return false

        const { selection } = view.state
        const draft = selection instanceof TextSelection && selection.empty
          ? findWikiDraft(view.state, selection.from)
          : null
        if (draft && (position < draft.from || position > draft.to)) {
          const transaction = acceptWikiDraft(view.state, draft, linkType)
          const mappedPosition = transaction.mapping.map(position, -1)
          transaction.setSelection(TextSelection.near(transaction.doc.resolve(mappedPosition)))
          transaction.setStoredMarks([])
          view.dispatch(transaction)
          return true
        }

        const transaction = view.state.tr
          .setSelection(TextSelection.near(view.state.doc.resolve(position)))
          .setStoredMarks([])
        view.dispatch(transaction)
        return true
      },
    },
  })
})
