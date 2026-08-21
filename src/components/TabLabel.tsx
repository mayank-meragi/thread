import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { TODAY_TAB_ID, type Tab } from '../lib/tabs'

export function TabLabel({ tab }: { tab: Tab }) {
  const pathname = tab.path.split('?')[0] || '/'
  if (tab.id === TODAY_TAB_ID) return <>Today</>
  if (pathname === '/search') return <>Search</>
  if (pathname === '/tasks') return <>Tasks</>
  if (pathname === '/settings') return <>Settings</>
  const threadMatch = pathname.match(/^\/thread\/(.+)$/)
  if (threadMatch) return <ThreadTabLabel threadId={decodeURIComponent(threadMatch[1])} />
  return <>{pathname}</>
}

function ThreadTabLabel({ threadId }: { threadId: string }) {
  const thread = useLiveQuery(() => db.threads.get(threadId), [threadId])
  return <>{thread?.title ?? threadId}</>
}
