import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, BookOpenText, Cloud, CloudOff, Layers, ListTodo, Search, Settings, Sparkle } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { HashRouter, Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { db, initializeDatabase } from './db'
import { isoToday } from './lib/dates'
import { getGitHubConfig, pullDay, syncPending } from './lib/github'
import { TodayPage } from './pages/TodayPage'
import { ThreadPage } from './pages/ThreadPage'
import { SearchPage } from './pages/SearchPage'
import { SettingsPage } from './pages/SettingsPage'
import { TasksPage } from './pages/TasksPage'
import { TabStrip } from './components/TabStrip'
import { MobileTabSwitcher } from './components/MobileTabSwitcher'
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
    const runSync = () => {
      setSyncing(true)
      void syncPending()
        .then(() => setSyncError(null))
        .catch((error) => setSyncError(error instanceof Error ? error.message : String(error)))
        .finally(() => setSyncing(false))
    }
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
  }, [connected])

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
    const openSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        navigate('/search')
      }
    }
    window.addEventListener('keydown', openSearch)
    return () => window.removeEventListener('keydown', openSearch)
  }, [navigate])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/" className="brand"><span className="brand-mark"><Sparkle size={16} /></span><span>Thread</span></Link>
        <nav className="main-nav">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive ? 'active' : ''}>
              <Icon size={17} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-section">
          <div className="sidebar-label">Recent threads</div>
          {threads.map((thread) => (
            <NavLink className="thread-link" key={thread.id} to={`/thread/${thread.id}`}>
              <span className="thread-dot" /> <span>{thread.title}</span>
            </NavLink>
          ))}
        </div>
        <div className="sidebar-foot">
          <Link to="/settings" className={`sync-state${conflicts > 0 || syncError ? ' sync-state-alert' : ''}`}>
            {!connected
              ? <CloudOff size={15} />
              : conflicts > 0 || syncError
                ? <AlertTriangle size={15} />
                : <Cloud size={15} />}
            <span>
              {syncing
                ? 'Syncing…'
                : !connected
                  ? 'Local only'
                  : conflicts > 0
                    ? `${conflicts} need${conflicts === 1 ? 's' : ''} attention`
                    : syncError
                      ? 'Sync error'
                      : pending
                        ? `${pending} pending`
                        : 'Up to date'}
            </span>
          </Link>
        </div>
      </aside>

      <main className="main-content">
        <TabStrip />
        {mountedIds.map((id) => {
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
        })}
      </main>

      <nav className="mobile-nav">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive ? 'active' : ''}>
            <Icon size={19} /><span>{label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={tabSwitcherOpen ? 'active' : ''}
          aria-label="Open tabs"
          onClick={() => setTabSwitcherOpen(true)}
        >
          <Layers size={19} /><span>{tabs.length > 1 ? `Tabs (${tabs.length})` : 'Tabs'}</span>
        </button>
      </nav>

      <MobileTabSwitcher open={tabSwitcherOpen} onClose={() => setTabSwitcherOpen(false)} />
    </div>
  )
}

export default function App() {
  useEffect(() => {
    void initializeDatabase(isoToday())
  }, [])

  return <HashRouter><TabsProvider><AppShell /></TabsProvider></HashRouter>
}
