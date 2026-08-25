import { db, saveDay } from '../db'
import type { OutlineBlock } from './outline'

function subtreeEnd(blocks: OutlineBlock[], rootIndex: number): number {
  const root = blocks[rootIndex]
  let index = rootIndex + 1
  while (index < blocks.length && blocks[index].depth > root.depth) index += 1
  return index
}

export async function deleteBlock(blockId: string): Promise<void> {
  const block = await db.blocks.get(blockId)
  if (!block) throw new Error('This block no longer exists.')
  const day = await db.days.get(block.day)
  if (!day) throw new Error('The source day no longer exists.')
  const blocks = await db.blocks.where('day').equals(block.day).sortBy('order')
  const rootIndex = blocks.findIndex((candidate) => candidate.id === blockId)
  if (rootIndex < 0) throw new Error('The block source could not be found.')
  const endIndex = subtreeEnd(blocks, rootIndex)
  const lines = day.markdown.split('\n')
  const startLine = blocks[rootIndex].order
  const endLine = blocks[endIndex]?.order ?? lines.length
  lines.splice(startLine, endLine - startLine)
  const markdown = lines.join('\n') || '- '
  await saveDay(block.day, markdown)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('thread:day-external-update', { detail: { day: block.day, markdown } }))
  }
}
