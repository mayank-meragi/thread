import { useLocation } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { NavLink } from 'react-router-dom'
import { db } from '../../db'
import { useThreadSummary } from '../../lib/threadSummary'

export function ContextRail() {
  const location = useLocation()
  const threads = useLiveQuery(() => db.threads.orderBy('updatedAt').reverse().limit(7).toArray(), [], [])
  const activeThreadId = location.pathname.match(/^\/thread\/([^/?]+)/)?.[1] ?? null
  const { thread: activeThread, openTasks, decisionsCount, direction } = useThreadSummary(activeThreadId)

  return (
    <div className="context-rail">
      <div className="right-rail-section">
        <div className="sidebar-label">Recent threads</div>
        <div className="right-rail-threads">
          {threads.map((thread) => (
            <NavLink className="thread-link" key={thread.id} to={`/thread/${thread.id}`} aria-label={thread.title}>
              <span className="thread-dot" /> <span>{thread.title}</span>
            </NavLink>
          ))}
          {threads.length === 0 && <p className="empty-hint">Type <code>[[a name]]</code> to start a thread.</p>}
        </div>
      </div>
      {activeThread && (
        <div className="right-rail-section right-rail-current">
          <div className="sidebar-label">This thread</div>
          <h2>{activeThread.title}</h2>
          {direction && <p className="context-copy">{direction}</p>}
          <div className="context-stats">
            <div><strong>{openTasks}</strong><span>open tasks</span></div>
            <div><strong>{decisionsCount}</strong><span>decisions</span></div>
          </div>
        </div>
      )}
    </div>
  )
}
