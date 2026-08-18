import { InputRule } from '@milkdown/prose/inputrules'
import { linkSchema } from '@milkdown/preset-commonmark'
import { Plugin, TextSelection } from '@milkdown/prose/state'
import type { EditorState, Transaction } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import { $inputRule, $prose } from '@milkdown/utils'
import { slugifyThread } from './outline'

export const WIKI_TITLE = 'thread-wikilink'

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
  hasClosingBrackets: boolean
}

function findRawWikiDraft(state: EditorState, cursor: number): WikiDraft | null {
  const $cursor = state.doc.resolve(cursor)
  if (!$cursor.parent.isTextblock) return null
  const before = $cursor.parent.textBetween(0, $cursor.parentOffset, undefined, '\ufffc')
  const after = $cursor.parent.textBetween($cursor.parentOffset, $cursor.parent.content.size, undefined, '\ufffc')
  const match = before.match(/\[\[([^]+)$/)
  if (!match || match[1].includes('[') || match[1].includes(']')) return null
  const title = match[1].trim()
  const hasClosingBrackets = after.startsWith(']]')
  return {
    from: $cursor.start() + before.length - match[0].length,
    to: cursor + (hasClosingBrackets ? 2 : 0),
    title,
    hasClosingBrackets,
  }
}

function findWikiDraft(state: EditorState, cursor: number): WikiDraft | null {
  const draft = findRawWikiDraft(state, cursor)
  return draft && slugifyThread(draft.title) ? draft : null
}

function findWikiDraftBeforeSecondCloser(state: EditorState, cursor: number): WikiDraft | null {
  const $cursor = state.doc.resolve(cursor)
  if (!$cursor.parent.isTextblock) return null
  const before = $cursor.parent.textBetween(0, $cursor.parentOffset, undefined, '\ufffc')
  const match = before.match(/\[\[([^\x5b\x5d]+)\]$/)
  if (!match) return null
  const title = match[1].trim()
  if (!slugifyThread(title)) return null
  return {
    from: $cursor.start() + before.length - match[0].length,
    to: cursor,
    title,
    hasClosingBrackets: false,
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
      decorations(state) {
        const { selection } = state
        if (!(selection instanceof TextSelection) || !selection.empty) return DecorationSet.empty
        const draft = findRawWikiDraft(state, selection.from)
        if (!draft || draft.hasClosingBrackets) return DecorationSet.empty
        return DecorationSet.create(state.doc, [
          Decoration.widget(selection.from, () => {
            const closer = document.createElement('span')
            closer.className = 'wiki-draft-closer'
            closer.textContent = ']]'
            closer.setAttribute('aria-hidden', 'true')
            return closer
          }, { side: 1 }),
        ])
      },
      handleTextInput(view, from, _to, text) {
        if (text === ']') {
          const draft = findWikiDraftBeforeSecondCloser(view.state, from)
          if (draft) {
            view.dispatch(acceptWikiDraft(view.state, draft, linkType))
            return true
          }
        }
        return false
      },
      handleKeyDown(view, event) {
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
      handleDOMEvents: {
        blur(view) {
          const { selection } = view.state
          if (!(selection instanceof TextSelection) || !selection.empty) return false
          const draft = findWikiDraft(view.state, selection.from)
          if (!draft) return false
          view.dispatch(acceptWikiDraft(view.state, draft, linkType))
          return false
        },
      },
    },
  })
})
