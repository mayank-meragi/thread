import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, BookOpenText, Cloud, CloudOff, ListTodo, Plus, Search, Settings, Sparkle } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { HashRouter, Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { db, initializeDatabase } from './db'
import { formatShortDate, isoToday } from './lib/dates'
import { getGitHubConfig, pullDay, syncPending } from './lib/github'
import { useThreadSummary } from './lib/threadSummary'
import { TodayPage } from './pages/TodayPage'
import { ThreadPage } from './pages/ThreadPage'
import { SearchPage } from './pages/SearchPage'
import { SettingsPage } from './pages/SettingsPage'
import { TasksPage } from './pages/TasksPage'
import { TabStrip } from './components/TabStrip'
import { MobileTabSwitcher } from './components/MobileTabSwitcher'
import { GlobalCommandMenu } from './components/GlobalCommandMenu'
import { TabsProvider, useTabs } from './lib/tabs'

const nav = [
  { to: '/', label: 'Today', icon: BookOpenText, end: true },
  { to: '/tasks', label: 'Tasks', icon: ListTodo },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function AppShell() {
  const navigate = useNavigate()
  const { tabs, mountedIds, activeId } = useTabs()
  const threads = useLiveQuery(() => db.threads.orderBy('updatedAt').reverse().limit(7).toArray(), [], [])
  const pending = useLiveQuery(() => db.outbox.count(), [], 0)
  const conflicts = useLiveQuery(() => db.conflicts.filter((conflict) => !conflict.resolvedAt).count(), [], 0)
  const [connected, setConnected] = useState(() => Boolean(getGitHubConfig()))
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [tabSwitcherOpen, setTabSwitcherOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const closeCommand = useCallback(() => setCommandOpen(false), [])
  const openTabSwitcher = useCallback(() => setTabSwitcherOpen(true), [])
  const closeTabSwitcher = useCallback(() => setTabSwitcherOpen(false), [])

  const activeTab = tabs.find((tab) => tab.id === activeId)
  const activeThreadId = activeTab?.path.match(/^\/thread\/([^/?]+)/)?.[1] ?? null
  const { thread: activeThread, openTasks, decisionsCount, direction } = useThreadSummary(activeThreadId)

  const runSync = useCallback(() => {
    if (!getGitHubConfig()) return
    setSyncing(true)
    void syncPending()
      .then(() => setSyncError(null))
      .catch((error) => setSyncError(error instanceof Error ? error.message : String(error)))
      .finally(() => setSyncing(false))
  }, [])

  useEffect(() => {
    const refresh = () => setConnected(Boolean(getGitHubConfig()))
    window.addEventListener('thread:github-config', refresh)
    return () => window.removeEventListener('thread:github-config', refresh)
  }, [])

  // Resolving a conflict in Settings doesn't go through this component's own
  // sync cycle, so a stale "Sync error" badge (from the sync attempt that
  // originally hit the conflict) would otherwise linger until some unrelated
  // future edit happened to trigger another sync. Clear it specifically when
  // the open-conflict count drops -- not just whenever it's zero, since that
  // would also mask a genuine unrelated error (e.g. auth) that has nothing to
  // do with conflicts.
  const previousConflicts = useRef(conflicts)
  useEffect(() => {
    if (conflicts < previousConflicts.current) setSyncError(null)
    previousConflicts.current = conflicts
  }, [conflicts])

  useEffect(() => {
    if (!connected) return
    let timer: number | null = null
    // Debounced off the last local write, not off the outbox's item *count*.
    // A day's outbox entry is upserted under one fixed key, so its count
    // doesn't change across a typing burst -- keying the debounce to a value
    // that stays constant while the user keeps typing meant the timer never
    // actually reset, and fired mid-sentence rather than after the user
    // stopped.
    const scheduleSync = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(runSync, 2200)
    }
    // Catch up on anything already queued -- e.g. left over from a previous
    // session, or queued while offline -- instead of waiting for a new edit.
    void db.outbox.count().then((count) => { if (count > 0) scheduleSync() })
    window.addEventListener('thread:local-write', scheduleSync)
    return () => {
      window.removeEventListener('thread:local-write', scheduleSync)
      if (timer) window.clearTimeout(timer)
    }
  }, [connected, runSync])

  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden' && connected) {
        void syncPending()
          .then(() => setSyncError(null))
          .catch((error) => setSyncError(error instanceof Error ? error.message : String(error)))
      }
    }
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('online', flush)
    return () => {
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('online', flush)
    }
  }, [connected])

  // Sync only ever pushed local changes -- it never checked whether another
  // device had pushed something newer for a day this browser already has.
  // "Up to date" meant only "nothing local is queued to push," which said
  // nothing about agreement with the remote. Keep Today's file fresh at
  // well-defined, low-risk moments only: once on connect, and whenever the
  // tab regains focus or the network comes back. Those are points where the
  // user has just returned to the tab and is very unlikely to be mid-
  // keystroke. A blind periodic timer was tried and removed: it fires at a
  // moment with no relation to what the user is doing, so it could (and did)
  // land in the middle of an active typing burst. MarkdownEditor's own guard
  // against applying an external update while there's unsaved local input is
  // the real safety net either way -- these triggers just decide when it's
  // worth asking.
  useEffect(() => {
    if (!connected) return
    const pullToday = () => void pullDay(isoToday())
    pullToday()
    const onVisible = () => {
      if (document.visibilityState === 'visible') pullToday()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', pullToday)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', pullToday)
    }
  }, [connected])

  useEffect(() => {
    const openGlobalActions = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        navigate('/search')
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLocaleLowerCase() === 'p') {
        event.preventDefault()
        setCommandOpen(true)
      }
    }
    window.addEventListener('keydown', openGlobalActions)
    return () => window.removeEventListener('keydown', openGlobalActions)
  }, [navigate])

  return (
    <div className="app-shell">
      <aside className="icon-rail" aria-label="Application navigation">
        <Link to="/" className="rail-brand" aria-label="Thread, open Today"><Sparkle size={16} /></Link>
        <nav className="rail-nav" aria-label="Primary destinations">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} aria-label={label} title={label} className={({ isActive }) => isActive ? 'active' : ''}>
              <Icon size={18} />
            </NavLink>
          ))}
        </nav>
        <div className="rail-foot">
          <button type="button" className="rail-create" aria-label="Create or go" title="Create or go (⌘⇧P)" onClick={() => setCommandOpen(true)} aria-keyshortcuts="Meta+Shift+P Control+Shift+P">
            <Plus size={18} />
          </button>
          <RailSyncIndicator connected={connected} syncing={syncing} pending={pending} conflicts={conflicts} error={syncError} onSync={runSync} />
        </div>
      </aside>

      <header className="mobile-topbar">
        <Link to="/" className="rail-brand" aria-label="Thread, open Today"><Sparkle size={16} /></Link>
        <span className="mobile-topbar-date">{formatShortDate(isoToday())}</span>
        <RailSyncIndicator connected={connected} syncing={syncing} pending={pending} conflicts={conflicts} error={syncError} onSync={runSync} />
        <Link to="/search" className="mobile-topbar-search" aria-label="Search"><Search size={16} /></Link>
      </header>

      <div className="content-shell">
        <TabStrip />
        <div className="content-row">
          <main className="main-content">
            {activeId ? mountedIds.map((id) => {
              const tab = tabs.find((candidate) => candidate.id === id)
              if (!tab) return null
              return (
                <div key={id} className="tab-panel" hidden={id !== activeId}>
                  <Routes location={tab.path}>
                    <Route path="/" element={<TodayPage />} />
                    <Route path="/thread/:threadId" element={<ThreadPage />} />
                    <Route path="/tasks" element={<TasksPage />} />
                    <Route path="/search" element={<SearchPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                  </Routes>
                </div>
              )
            }) : (
              <div className="destination-panel">
                <Routes>
                  <Route path="/tasks" element={<TasksPage />} />
                  <Route path="/search" element={<SearchPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Routes>
              </div>
            )}
          </main>

          <aside className="right-rail" aria-label="Recent threads and current thread context">
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
          </aside>
        </div>
      </div>

      <nav className="mobile-nav" aria-label="Mobile primary destinations">
        <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}><BookOpenText size={19} /><span>Today</span></NavLink>
        <NavLink to="/tasks" className={({ isActive }) => isActive ? 'active' : ''}><ListTodo size={19} /><span>Tasks</span></NavLink>
        <button
          type="button"
          className="mobile-create"
          aria-label="Create or go"
          aria-keyshortcuts="Meta+Shift+P Control+Shift+P"
          onClick={() => setCommandOpen(true)}
        >
          <span className="mobile-create-mark"><Plus size={19} /></span><span>Create</span>
        </button>
        <NavLink to="/search" className={({ isActive }) => isActive ? 'active' : ''}><Search size={19} /><span>Search</span></NavLink>
        <NavLink to="/settings" className={({ isActive }) => isActive ? 'active' : ''}><Settings size={19} /><span>Settings</span></NavLink>
      </nav>

      <GlobalCommandMenu open={commandOpen} tabCount={tabs.length} onClose={closeCommand} onOpenTabs={openTabSwitcher} />
      <MobileTabSwitcher open={tabSwitcherOpen} onClose={closeTabSwitcher} />
    </div>
  )
}

function RailSyncIndicator({
  connected,
  syncing,
  pending,
  conflicts,
  error,
  onSync,
}: {
  connected: boolean
  syncing: boolean
  pending: number
  conflicts: number
  error: string | null
  onSync: () => void
}) {
  if (!connected) {
    return <Link to="/settings?focus=sync" className="rail-sync" aria-label="Local only. Notes are saved on this device. Connect GitHub sync." title="Local only"><CloudOff size={16} /></Link>
  }
  if (conflicts > 0 || error) {
    const detail = conflicts > 0 ? `${conflicts} ${conflicts === 1 ? 'conflict' : 'conflicts'} to resolve` : 'Sync could not finish'
    return <Link to="/settings?focus=sync" className="rail-sync rail-sync-alert" aria-label={`Needs attention. ${detail}. Open sync settings.`} title="Needs attention"><AlertTriangle size={16} /></Link>
  }
  if (syncing) {
    return <div className="rail-sync rail-sync-busy" role="status" aria-live="polite" title="Syncing" aria-label="Syncing"><Cloud size={16} /></div>
  }
  if (pending > 0) {
    return <button type="button" className="rail-sync rail-sync-pending" onClick={onSync} aria-label={`Pending. ${pending} ${pending === 1 ? 'change' : 'changes'} waiting. Sync now.`} title="Pending changes"><Cloud size={16} /></button>
  }
  return <Link to="/settings?focus=sync" className="rail-sync" aria-label="Up to date. Local changes are backed up to GitHub. Open sync settings." title="Up to date"><Cloud size={16} /></Link>
}

export default function App() {
  useEffect(() => {
    void initializeDatabase(isoToday())
  }, [])

  return <HashRouter><TabsProvider><AppShell /></TabsProvider></HashRouter>
}
