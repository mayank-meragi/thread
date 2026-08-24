import { useEffect, useRef } from 'react'
import { BookOpenText, ListTodo, Search, Settings } from 'lucide-react'
import { TabLabel } from '../TabLabel'

export interface SwitcherTab {
  id: string
  path: string
}

interface TabSwitcherProps {
  tabs: SwitcherTab[]
  selected: number
  onHighlight: (index: number) => void
  onCommit: (index: number) => void
  onCancel: () => void
}

function iconForPath(path: string): { Icon: typeof BookOpenText; kind: string } {
  const pathname = path.split('?')[0] || '/'
  if (pathname === '/tasks') return { Icon: ListTodo, kind: 'k-tasks' }
  if (pathname === '/search') return { Icon: Search, kind: 'k-search' }
  if (pathname === '/settings') return { Icon: Settings, kind: 'k-settings' }
  return { Icon: BookOpenText, kind: pathname === '/' ? 'k-today' : 'k-thread' }
}

export function TabSwitcher({ tabs, selected, onHighlight, onCommit, onCancel }: TabSwitcherProps) {
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    gridRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <div
      className="layer-backdrop layer-backdrop-center layer-backdrop-blur tab-switcher-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <section className="dialog tab-switcher" role="dialog" aria-modal="true" aria-label="Switch tabs">
        <header>
          <span className="eyebrow">Open tabs</span>
          <span className="tab-switcher-hint">Most recently used &mdash; release <kbd>Option</kbd> or press <kbd>Enter</kbd> to switch</span>
        </header>
        <div ref={gridRef} className="tab-switcher-grid" role="listbox" aria-label="Open tabs">
          {tabs.map((tab, index) => {
            const { Icon, kind } = iconForPath(tab.path)
            return (
              <button
                key={tab.id}
                type="button"
                role="option"
                aria-selected={index === selected}
                className={`tab-card${index === selected ? ' selected' : ''}`}
                onMouseEnter={() => onHighlight(index)}
                onClick={() => onCommit(index)}
              >
                <span className={`tab-card-icon ${kind}`}><Icon size={14} /></span>
                <span className="tab-card-label"><TabLabel path={tab.path} /></span>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
