import { X } from 'lucide-react'
import type { IDockviewHeaderActionsProps } from 'dockview-react'
import { TOGGLE_RAIL_EVENT } from '../../lib/dockviewActions'

// Only the context rail header keeps an action (hide). Editor tab bars stay
// clear so tabs are not clipped by a duplicate layout toggle.
export function GroupActions({ location }: IDockviewHeaderActionsProps) {
  if (location?.type !== 'edge') return null
  return (
    <div className="rail-header-actions">
      <button
        type="button"
        className="header-action"
        aria-label="Hide context panel"
        title="Hide context panel (⌘\)"
        onClick={() => window.dispatchEvent(new Event(TOGGLE_RAIL_EVENT))}
      >
        <X size={14} />
      </button>
    </div>
  )
}
