import { Button } from 'fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpenText, ChefHat, Dumbbell, ListTodo, Menu, Plus, Rss } from 'lucide-react'
import { HashRouter, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { initializeDatabase } from './db'
import { isoToday } from './lib/dates'
import { OPEN_CHAT_EVENT, TOGGLE_RAIL_EVENT } from './lib/dockviewActions'
import { isUserActivityBarHidden, toggleActivityBarHidden } from './lib/activityBar'
import { DockviewTabs } from './components/tabs/DockviewTabs'
import { Omnibox } from './components/Omnibox'
import { ContextualInspector } from './components/ContextualInspector'
import { MobileRailDrawer } from './components/shell/MobileRailDrawer'
import { ActivityBar } from './components/shell/ActivityBar'
import { TitleBar } from './components/shell/TitleBar'
import { useGitHubSync } from './hooks/useGitHubSync'

function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const sync = useGitHubSync()
  const [omnibox, setOmnibox] = useState<{ open: boolean; mode: 'command' | 'search' }>({ open: false, mode: 'command' })
  const [activityBarHidden, setActivityBarHidden] = useState(() => isUserActivityBarHidden())
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const mobileMoreRef = useRef<HTMLDivElement>(null)
  const closeOmnibox = useCallback(() => setOmnibox((state) => ({ ...state, open: false })), [])
  const openCommand = useCallback(() => setOmnibox({ open: true, mode: 'command' }), [])
  const openOmniboxSearch = useCallback(() => setOmnibox({ open: true, mode: 'search' }), [])
  const toggleRail = useCallback(() => {
    window.dispatchEvent(new Event(TOGGLE_RAIL_EVENT))
  }, [])
  const openChat = useCallback(() => {
    window.dispatchEvent(new Event(OPEN_CHAT_EVENT))
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
        openCommand()
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLocaleLowerCase() === 'o') {
        event.preventDefault()
        openOmniboxSearch()
      }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key === '\\') {
        event.preventDefault()
        toggleRail()
      }
    }
    window.addEventListener('keydown', openGlobalActions)
    return () => window.removeEventListener('keydown', openGlobalActions)
  }, [navigate, toggleRail, openCommand, openOmniboxSearch])

  useEffect(() => {
    if (!mobileMoreOpen) return
    const closeOnOutside = (event: MouseEvent) => {
      if (mobileMoreRef.current && !mobileMoreRef.current.contains(event.target as Node)) setMobileMoreOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMoreOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [mobileMoreOpen])

  const syncProps = {
    connected: sync.connected,
    syncing: sync.syncing,
    pending: sync.pending,
    conflicts: sync.conflicts,
    error: sync.error,
    progress: sync.progress,
    onSync: () => { void sync.runSync() },
    onRefresh: () => { void sync.runSync(true) },
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
        <ActivityBar hidden={activityBarHidden} onOpenCommand={openCommand} onOpenChat={openChat} sync={syncProps} />

        <div className="content-shell">
          <div className="content-row">
            <DockviewTabs />
          </div>
        </div>
      </div>

      <nav className="mobile-nav" aria-label="Mobile primary destinations">
        <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}><BookOpenText size={19} /><span>Today</span></NavLink>
        <NavLink to="/tasks" className={({ isActive }) => isActive ? 'active' : ''}><ListTodo size={19} /><span>Tasks</span></NavLink>
        <Button unstyled
          type="button"
          className="mobile-create"
          aria-label="Create or go"
          aria-keyshortcuts="Meta+Shift+P Control+Shift+P"
          onClick={openCommand}
        >
          <span className="mobile-create-mark"><Plus size={19} /></span><span>Create</span>
        </Button>
        <NavLink to="/workouts" className={({ isActive }) => isActive ? 'active' : ''}><Dumbbell size={19} /><span>Workouts</span></NavLink>
        <div className="mobile-more" ref={mobileMoreRef}>
          <Button unstyled
            type="button"
            className={`mobile-more-trigger${location.pathname === '/feeds' || location.pathname.startsWith('/recipe') ? ' active' : ''}`}
            aria-label="More navigation"
            aria-haspopup="menu"
            aria-expanded={mobileMoreOpen}
            onClick={() => setMobileMoreOpen((current) => !current)}
          >
            <Menu size={19} aria-hidden="true" /><span>More</span>
          </Button>
          {mobileMoreOpen && (
            <div className="mobile-more-menu" role="menu" aria-label="More destinations">
              <NavLink to="/feeds" role="menuitem" onClick={() => setMobileMoreOpen(false)}><Rss size={17} aria-hidden="true" /><span>Feed</span></NavLink>
              <NavLink to="/recipes" role="menuitem" onClick={() => setMobileMoreOpen(false)}><ChefHat size={17} aria-hidden="true" /><span>Recipe</span></NavLink>
            </div>
          )}
        </div>
      </nav>

      <Omnibox open={omnibox.open} initialMode={omnibox.mode} onClose={closeOmnibox} onTogglePanel={toggleRail} />
      <ContextualInspector />
      <MobileRailDrawer />
    </div>
  )
}

export default function App() {
  const [databaseReady, setDatabaseReady] = useState(false)
  useEffect(() => {
    let active = true
    void initializeDatabase(isoToday()).finally(() => { if (active) setDatabaseReady(true) })
    return () => { active = false }
  }, [])

  if (!databaseReady) return <div className="page-loading">Opening Thread…</div>
  return <HashRouter><AppShell /></HashRouter>
}
