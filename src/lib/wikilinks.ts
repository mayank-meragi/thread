import { InputRule } from '@milkdown/prose/inputrules'
import { linkSchema } from '@milkdown/preset-commonmark'
import { $inputRule } from '@milkdown/utils'
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
