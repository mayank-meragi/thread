import { useCallback, useEffect, useState } from 'react'
import { BookOpenText, ListTodo, Plus, Search, Settings } from 'lucide-react'
import { HashRouter, NavLink, useNavigate } from 'react-router-dom'
import { initializeDatabase } from './db'
import { isoToday } from './lib/dates'
import { TOGGLE_RAIL_EVENT } from './lib/dockviewActions'
import { isUserActivityBarHidden, toggleActivityBarHidden } from './lib/activityBar'
import { DockviewTabs } from './components/tabs/DockviewTabs'
import { GlobalCommandMenu } from './components/GlobalCommandMenu'
import { ActivityBar } from './components/shell/ActivityBar'
import { TitleBar } from './components/shell/TitleBar'
import { useGitHubSync } from './hooks/useGitHubSync'

function AppShell() {
  const navigate = useNavigate()
  const sync = useGitHubSync()
  const [commandOpen, setCommandOpen] = useState(false)
  const [activityBarHidden, setActivityBarHidden] = useState(() => isUserActivityBarHidden())
  const closeCommand = useCallback(() => setCommandOpen(false), [])
  const openCommand = useCallback(() => setCommandOpen(true), [])
  const toggleRail = useCallback(() => {
    window.dispatchEvent(new Event(TOGGLE_RAIL_EVENT))
  }, [])
  const toggleActivityBar = useCallback(() => {
    setActivityBarHidden(toggleActivityBarHidden())
  }, [])

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
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key === '\\') {
        event.preventDefault()
        toggleRail()
      }
    }
    window.addEventListener('keydown', openGlobalActions)
    return () => window.removeEventListener('keydown', openGlobalActions)
  }, [navigate, toggleRail])

  const syncProps = {
    connected: sync.connected,
    syncing: sync.syncing,
    pending: sync.pending,
    conflicts: sync.conflicts,
    error: sync.error,
    onSync: sync.runSync,
  }

  return (
    <div className={`app-shell${activityBarHidden ? ' activity-bar-hidden' : ''}`}>
      <TitleBar
        activityBarHidden={activityBarHidden}
        onToggleActivityBar={toggleActivityBar}
        onOpenCommand={openCommand}
        sync={syncProps}
      />

      <div className="workbench">
        <ActivityBar hidden={activityBarHidden} onOpenCommand={openCommand} sync={syncProps} />

        <div className="content-shell">
          <div className="content-row">
            <DockviewTabs />
          </div>
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
          onClick={openCommand}
        >
          <span className="mobile-create-mark"><Plus size={19} /></span><span>Create</span>
        </button>
        <NavLink to="/search" className={({ isActive }) => isActive ? 'active' : ''}><Search size={19} /><span>Search</span></NavLink>
        <NavLink to="/settings" className={({ isActive }) => isActive ? 'active' : ''}><Settings size={19} /><span>Settings</span></NavLink>
      </nav>

      <GlobalCommandMenu open={commandOpen} onClose={closeCommand} onTogglePanel={toggleRail} />
    </div>
  )
}

export default function App() {
  useEffect(() => {
    void initializeDatabase(isoToday())
  }, [])

  return <HashRouter><AppShell /></HashRouter>
}
