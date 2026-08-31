import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'

export function TabLabel({ path }: { path: string }) {
  const pathname = path.split('?')[0] || '/'
  if (pathname === '/') return <>Today</>
  if (pathname === '/search') return <>Search</>
  if (pathname === '/tasks') return <>Tasks</>
  if (pathname === '/settings') return <>Settings</>
  if (pathname === '/templates') return <>Templates</>
  if (pathname === '/docs' || pathname.startsWith('/docs/')) return <>Docs</>
  const threadMatch = pathname.match(/^\/thread\/(.+)$/)
  if (threadMatch) return <ThreadTabLabel threadId={decodeURIComponent(threadMatch[1])} />
  return <>{pathname}</>
}

function ThreadTabLabel({ threadId }: { threadId: string }) {
  const thread = useLiveQuery(() => db.threads.get(threadId), [threadId])
  return <>{thread?.title ?? threadId}</>
}
