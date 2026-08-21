import { InputRule } from '@milkdown/prose/inputrules'
import { linkSchema } from '@milkdown/preset-commonmark'
import { $inputRule } from '@milkdown/utils'
import { slugifyTag } from './hashtags'

export const TAG_TITLE = 'thread-tag'
export const TAG_HREF_PREFIX = '#tag/'

export function tagLinksToEditor(markdown: string): string {
  return markdown.replace(/#\[([^\]]+)\]/g, (match, rawName: string) => {
    const name = rawName.trim()
    const tagId = slugifyTag(name)
    return tagId ? `[${name}](${TAG_HREF_PREFIX}${tagId} "${TAG_TITLE}")` : match
  })
}

export function editorLinksToTags(markdown: string): string {
  return markdown.replace(
    /\[([^\]]+)\]\(#tag\/[^\s)]+(?:\s+["']thread-tag["'])?\)/g,
    '#[$1]',
  )
}

export const tagLinkInputRule = $inputRule((ctx) => new InputRule(
  /#\[([^\]]+)\]$/,
  (state, match, start, end) => {
    const name = match[1].trim()
    const tagId = slugifyTag(name)
    if (!tagId) return null
    const mark = linkSchema.type(ctx).create({ href: `${TAG_HREF_PREFIX}${tagId}`, title: TAG_TITLE })
    return state.tr.replaceWith(start, end, state.schema.text(name, [mark]))
  },
))
