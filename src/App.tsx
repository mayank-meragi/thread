import { useEffect, useState } from 'react'
import { AlertTriangle, BookOpenText, Cloud, CloudOff, Search, Settings, Sparkle } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { HashRouter, Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { db, initializeDatabase } from './db'
import { isoToday } from './lib/dates'
import { getGitHubConfig, pullDay, syncPending } from './lib/github'
import { TodayPage } from './pages/TodayPage'
import { ThreadPage } from './pages/ThreadPage'
import { SearchPage } from './pages/SearchPage'
import { SettingsPage } from './pages/SettingsPage'

const nav = [
  { to: '/', label: 'Today', icon: BookOpenText, end: true },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function AppShell() {
  const navigate = useNavigate()
  const threads = useLiveQuery(() => db.threads.orderBy('updatedAt').reverse().limit(7).toArray(), [], [])
  const pending = useLiveQuery(() => db.outbox.count(), [], 0)
  const conflicts = useLiveQuery(() => db.conflicts.filter((conflict) => !conflict.resolvedAt).count(), [], 0)
  const [connected, setConnected] = useState(() => Boolean(getGitHubConfig()))
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  useEffect(() => {
    const refresh = () => setConnected(Boolean(getGitHubConfig()))
    window.addEventListener('thread:github-config', refresh)
    return () => window.removeEventListener('thread:github-config', refresh)
  }, [])

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
  // nothing about agreement with the remote. Keep Today's file fresh: once on
  // connect, again whenever the tab regains focus or comes back online, and
  // periodically while the tab stays open and visible (the common case for a
  // daily-first app left open all day).
  useEffect(() => {
    if (!connected) return
    const pullToday = () => void pullDay(isoToday())
    pullToday()
    const onVisible = () => {
      if (document.visibilityState === 'visible') pullToday()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', pullToday)
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') pullToday()
    }, 90_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', pullToday)
      window.clearInterval(interval)
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
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/thread/:threadId" element={<ThreadPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      <nav className="mobile-nav">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive ? 'active' : ''}>
            <Icon size={19} /><span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  useEffect(() => {
    void initializeDatabase(isoToday())
  }, [])

  return <HashRouter><AppShell /></HashRouter>
}
