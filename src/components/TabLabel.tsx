import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'

export function TabLabel({ path }: { path: string }) {
  const pathname = path.split('?')[0] || '/'
  if (pathname === '/') return <>Today</>
  if (pathname === '/search') return <>Search</>
  if (pathname === '/tasks') return <>Tasks</>
  if (pathname === '/workouts') return <>Workouts</>
  if (pathname === '/settings') return <>Settings</>
  if (pathname === '/templates') return <>Templates</>
  if (pathname === '/docs' || pathname.startsWith('/docs/')) return <>Docs</>
  const threadMatch = pathname.match(/^\/thread\/(.+)$/)
  if (threadMatch) return <ThreadTabLabel threadId={decodeURIComponent(threadMatch[1])} />
  const workoutMatch = pathname.match(/^\/workout\/([^/]+)\/([^/]+)(?:\/overview)?$/)
  if (workoutMatch) return <WorkoutTabLabel blockId={decodeURIComponent(workoutMatch[2])} />
  return <>{pathname}</>
}

function ThreadTabLabel({ threadId }: { threadId: string }) {
  const thread = useLiveQuery(() => db.threads.get(threadId), [threadId])
  return <>{thread?.title ?? threadId}</>
}

function WorkoutTabLabel({ blockId }: { blockId: string }) {
  const task = useLiveQuery(() => db.tasks.get(blockId), [blockId])
  const label = task?.text.replace(/^#\[?workout\]?\s*/, '').replace(/\[\[|\]\]/g, '').trim()
  return <>{label ? `${label} · Workout` : 'Workout'}</>
}
