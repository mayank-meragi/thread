import { useLiveQuery } from 'dexie-react-hooks'
import { db, type MentionRecord } from '../db'

const EMPTY_MENTIONS: MentionRecord[] = []

export function useThreadSummary(threadId: string | null) {
  const thread = useLiveQuery(() => (threadId ? db.threads.get(threadId) : undefined), [threadId])
  const mentions = useLiveQuery(
    () => (threadId ? db.mentions.where('threadId').equals(threadId).toArray() : Promise.resolve(EMPTY_MENTIONS)),
    [threadId],
    EMPTY_MENTIONS,
  )
  const openTasks = mentions.filter((item) => item.kind === 'task' && !item.checked).length
  const decisions = mentions.filter((item) => item.kind === 'decision')
  const thoughts = mentions.filter(
    (item) => item.kind === 'thought' && item.excerpt.toLocaleLowerCase() !== (thread?.title ?? '').toLocaleLowerCase(),
  )
  const direction = thoughts.at(-1)?.excerpt ?? decisions.at(-1)?.excerpt

  return { thread, openTasks, decisionsCount: decisions.length, direction }
}
