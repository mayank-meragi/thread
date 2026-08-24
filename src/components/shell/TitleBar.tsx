import { useEffect, useState } from 'react'
import { Search, Sparkle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatShortDate, isoToday } from '../../lib/dates'
import { isUserRailHidden, RAIL_VISIBILITY_EVENT, TOGGLE_RAIL_EVENT } from '../../lib/dockviewActions'
import { LayoutToggleIcon } from './LayoutToggleIcon'
import { RailSyncIndicator, type RailSyncIndicatorProps } from './RailSyncIndicator'

interface TitleBarProps {
  activityBarHidden: boolean
  onToggleActivityBar: () => void
  onOpenCommand: () => void
  sync: RailSyncIndicatorProps
}

export function TitleBar({ activityBarHidden, onToggleActivityBar, onOpenCommand, sync }: TitleBarProps) {
  const [railHidden, setRailHidden] = useState(() => isUserRailHidden())

  useEffect(() => {
    const syncVisibility = (event: Event) => {
      if (event instanceof CustomEvent && typeof event.detail?.hidden === 'boolean') {
        setRailHidden(event.detail.hidden)
        return
      }
      setRailHidden(isUserRailHidden())
    }
    window.addEventListener(RAIL_VISIBILITY_EVENT, syncVisibility)
    return () => window.removeEventListener(RAIL_VISIBILITY_EVENT, syncVisibility)
  }, [])

  const toggleRail = () => window.dispatchEvent(new Event(TOGGLE_RAIL_EVENT))

  return (
    <header className="title-bar">
      <div className="title-bar-brand">
        <Link to="/" className="title-bar-mark" aria-label="Thread, open Today"><Sparkle size={14} /></Link>
        <span className="title-bar-name">Thread</span>
        <span className="title-bar-date">{formatShortDate(isoToday())}</span>
      </div>

      <button
        type="button"
        className="title-bar-search"
        onClick={onOpenCommand}
        aria-label="Open create or go menu"
        aria-keyshortcuts="Meta+Shift+P Control+Shift+P"
        title="Create or go (⌘⇧P)"
      >
        <Search size={13} />
        <span>Search notes…</span>
        <kbd>⌘⇧P</kbd>
      </button>

      <div className="title-bar-actions">
        <RailSyncIndicator {...sync} />
        <button
          type="button"
          className="title-bar-search-icon"
          onClick={onOpenCommand}
          aria-label="Open create or go menu"
          title="Create or go"
        >
          <Search size={16} />
        </button>
        <div className="title-bar-toggles">
          <button
            type="button"
            className="tap-target-sm title-bar-toggle"
            aria-label={activityBarHidden ? 'Show activity bar' : 'Hide activity bar'}
            aria-pressed={!activityBarHidden}
            title={activityBarHidden ? 'Show activity bar' : 'Hide activity bar'}
            onClick={onToggleActivityBar}
          >
            <LayoutToggleIcon side="left" filled={!activityBarHidden} />
          </button>
          <button
            type="button"
            className="tap-target-sm title-bar-toggle"
            aria-label={railHidden ? 'Show context panel' : 'Hide context panel'}
            aria-pressed={!railHidden}
            aria-keyshortcuts="Meta+\\ Control+\\"
            title={railHidden ? 'Show context panel (⌘\\)' : 'Hide context panel (⌘\\)'}
            onClick={toggleRail}
          >
            <LayoutToggleIcon side="right" filled={!railHidden} />
          </button>
        </div>
      </div>
    </header>
  )
}
