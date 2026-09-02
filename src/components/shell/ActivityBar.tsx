import { Bot, BookOpenText, Dumbbell, ListTodo, Plus, Search, Settings } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { RailSyncIndicator, type RailSyncIndicatorProps } from './RailSyncIndicator'

const nav = [
  { to: '/', label: 'Today', icon: BookOpenText, end: true },
  { to: '/tasks', label: 'Tasks', icon: ListTodo },
  { to: '/workouts', label: 'Workouts', icon: Dumbbell },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/settings', label: 'Settings', icon: Settings },
]

interface ActivityBarProps {
  hidden: boolean
  onOpenCommand: () => void
  onOpenChat: () => void
  sync: RailSyncIndicatorProps
}

export function ActivityBar({ hidden, onOpenCommand, onOpenChat, sync }: ActivityBarProps) {
  return (
    <aside className="icon-rail" hidden={hidden} aria-label="Application navigation">
      <nav className="rail-nav" aria-label="Primary destinations">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} aria-label={label} title={label} className={({ isActive }) => isActive ? 'active' : ''}>
            <Icon size={18} />
          </NavLink>
        ))}
      </nav>
      <div className="rail-foot">
        <button type="button" className="rail-nav-item" aria-label="AI chat" title="AI chat" onClick={onOpenChat}>
          <Bot size={18} />
        </button>
        <button type="button" className="rail-create" aria-label="Create or go" title="Create or go (⌘⇧P)" onClick={onOpenCommand} aria-keyshortcuts="Meta+Shift+P Control+Shift+P">
          <Plus size={18} />
        </button>
        <RailSyncIndicator {...sync} />
      </div>
    </aside>
  )
}
