import { X } from 'lucide-react'
import { useTabs } from '../lib/tabs'
import { TabLabel } from './TabLabel'

export function TabStrip() {
  const { tabs, activeId, activateTab, closeTab } = useTabs()

  return (
    <div className="tab-strip" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === activeId}
          className={`tab-chip${tab.id === activeId ? ' active' : ''}`}
          onClick={() => activateTab(tab.id)}
        >
          <span className="tab-chip-label"><TabLabel tab={tab} /></span>
          {tab.closable && (
            <span
              className="tab-chip-close"
              role="button"
              aria-label="Close tab"
              onClick={(event) => {
                event.stopPropagation()
                closeTab(tab.id)
              }}
            >
              <X size={12} />
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
