import { useEffect, useState } from 'react'
import { BookOpenText, Cloud, CloudOff, Search, Settings, Sparkle } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { HashRouter, Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { db, initializeDatabase } from './db'
import { isoToday } from './lib/dates'
import { getGitHubConfig, syncPending } from './lib/github'
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
  const [connected, setConnected] = useState(() => Boolean(getGitHubConfig()))
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    const refresh = () => setConnected(Boolean(getGitHubConfig()))
    window.addEventListener('thread:github-config', refresh)
    return () => window.removeEventListener('thread:github-config', refresh)
  }, [])

  useEffect(() => {
    if (!connected || pending === 0 || syncing) return
    const timer = window.setTimeout(() => {
      setSyncing(true)
      void syncPending().catch(() => undefined).finally(() => setSyncing(false))
    }, 2200)
    return () => window.clearTimeout(timer)
  }, [connected, pending, syncing])

  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden' && connected) void syncPending()
    }
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('online', flush)
    return () => {
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('online', flush)
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
          <Link to="/settings" className="sync-state">
            {connected ? <Cloud size={15} /> : <CloudOff size={15} />}
            <span>{syncing ? 'Syncing…' : connected ? pending ? `${pending} pending` : 'Up to date' : 'Local only'}</span>
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
