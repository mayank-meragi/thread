import { X } from 'lucide-react'
import { useTabs } from '../lib/tabs'
import { TabLabel } from './TabLabel'

interface MobileTabSwitcherProps {
  open: boolean
  onClose: () => void
}

export function MobileTabSwitcher({ open, onClose }: MobileTabSwitcherProps) {
  const { tabs, activeId, activateTab, closeTab } = useTabs()
  if (!open) return null

  return (
    <div className="tab-switcher-overlay" role="dialog" aria-label="Open tabs">
      <header className="tab-switcher-header">
        <span>{tabs.length} {tabs.length === 1 ? 'tab' : 'tabs'}</span>
        <button type="button" className="tab-switcher-done" onClick={onClose}>Done</button>
      </header>
      <div className="tab-switcher-grid">
        {tabs.map((tab) => (
          <div key={tab.id} className={`tab-switcher-card${tab.id === activeId ? ' active' : ''}`}>
            <button
              type="button"
              className="tab-switcher-card-body"
              onClick={() => {
                activateTab(tab.id)
                onClose()
              }}
            >
              <span className="tab-switcher-card-label"><TabLabel tab={tab} /></span>
            </button>
            {tab.closable && (
              <button
                type="button"
                className="tab-switcher-card-close"
                aria-label="Close tab"
                onClick={(event) => {
                  event.stopPropagation()
                  closeTab(tab.id)
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
