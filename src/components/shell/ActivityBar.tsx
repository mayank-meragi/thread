import { Button, Tooltip } from 'fiber'
import { Bot, BookOpenText, ChefHat, Dumbbell, ListTodo, Plus, Rss, Search, Settings } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { RailSyncIndicator, type RailSyncIndicatorProps } from './RailSyncIndicator'

const nav = [
  { to: '/', label: 'Today', icon: BookOpenText, end: true },
  { to: '/tasks', label: 'Tasks', icon: ListTodo },
  { to: '/workouts', label: 'Workouts', icon: Dumbbell },
  { to: '/recipes', label: 'Recipes', icon: ChefHat },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/feeds', label: 'Feeds', icon: Rss },
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
          <Tooltip key={to} content={label}>
            <NavLink to={to} end={end} aria-label={label} className={({ isActive }) => isActive ? 'active' : ''}>
              <Icon size={18} />
            </NavLink>
          </Tooltip>
        ))}
      </nav>
      <div className="rail-foot">
        <Tooltip content="AI chat">
          <Button unstyled type="button" className="rail-nav-item" aria-label="AI chat" onClick={onOpenChat}>
            <Bot size={18} />
          </Button>
        </Tooltip>
        <Tooltip content="Create or go (⌘⇧P)">
          <Button unstyled type="button" className="rail-create" aria-label="Create or go" onClick={onOpenCommand} aria-keyshortcuts="Meta+Shift+P Control+Shift+P">
            <Plus size={18} />
          </Button>
        </Tooltip>
        <RailSyncIndicator {...sync} />
      </div>
    </aside>
  )
}
