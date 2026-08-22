import { X } from 'lucide-react'
import { useTabs } from '../lib/tabs'
import { TabLabel } from './TabLabel'

export function TabStrip() {
  const { tabs, activeId, activateTab, closeTab } = useTabs()

  const moveFocus = (id: string, direction: -1 | 1) => {
    const index = tabs.findIndex((tab) => tab.id === id)
    const next = tabs[(index + direction + tabs.length) % tabs.length]
    if (next) activateTab(next.id)
  }

  return (
    <div className="tab-strip-shell">
      <span className="tab-strip-label">Working tabs</span>
      <div className="tab-strip" role="tablist" aria-label="Working tabs">
        {tabs.map((tab) => (
          <div key={tab.id} className={`tab-chip${tab.id === activeId ? ' active' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === activeId}
              tabIndex={tab.id === activeId || !activeId ? 0 : -1}
              className="tab-chip-main"
              onClick={() => activateTab(tab.id)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') { event.preventDefault(); moveFocus(tab.id, -1) }
                if (event.key === 'ArrowRight') { event.preventDefault(); moveFocus(tab.id, 1) }
                if (event.key === 'Home') { event.preventDefault(); activateTab(tabs[0].id) }
                if (event.key === 'End') { event.preventDefault(); activateTab(tabs.at(-1)!.id) }
              }}
            >
              <span className="tab-chip-label"><TabLabel tab={tab} /></span>
            </button>
            {tab.closable && (
              <button type="button" className="tab-chip-close" aria-label="Close working tab" onClick={() => closeTab(tab.id)}>
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
