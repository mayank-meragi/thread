import { X } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { TODAY_TAB_ID, useTabs, type Tab } from '../lib/tabs'

export function TabStrip() {
  const { tabs, activeId, activateTab, closeTab } = useTabs()
  if (tabs.length <= 1) return null

  return (
    <div className="tab-strip" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === activeId}
          className={`tab-chip${tab.id === activeId ? ' active' : ''}`}
          onClick={() => activateTab(tab.id)}
        >
          <span className="tab-chip-label"><TabLabel tab={tab} /></span>
          {tab.closable && (
            <span
              className="tab-chip-close"
              role="button"
              aria-label="Close tab"
              onClick={(event) => {
                event.stopPropagation()
                closeTab(tab.id)
              }}
            >
              <X size={12} />
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

function TabLabel({ tab }: { tab: Tab }) {
  const pathname = tab.path.split('?')[0] || '/'
  if (tab.id === TODAY_TAB_ID) return <>Today</>
  if (pathname === '/search') return <>Search</>
  if (pathname === '/settings') return <>Settings</>
  const threadMatch = pathname.match(/^\/thread\/(.+)$/)
  if (threadMatch) return <ThreadTabLabel threadId={decodeURIComponent(threadMatch[1])} />
  return <>{pathname}</>
}

function ThreadTabLabel({ threadId }: { threadId: string }) {
  const thread = useLiveQuery(() => db.threads.get(threadId), [threadId])
  return <>{thread?.title ?? threadId}</>
}
