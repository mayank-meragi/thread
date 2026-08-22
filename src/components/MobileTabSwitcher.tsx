import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useTabs } from '../lib/tabs'
import { TabLabel } from './TabLabel'

interface MobileTabSwitcherProps {
  open: boolean
  onClose: () => void
}

export function MobileTabSwitcher({ open, onClose }: MobileTabSwitcherProps) {
  const { tabs, activeId, activateTab, closeTab } = useTabs()
  const doneRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    doneRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const controls = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])')]
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div ref={dialogRef} className="tab-switcher-overlay" role="dialog" aria-modal="true" aria-labelledby="working-tabs-title">
      <header className="tab-switcher-header">
        <div><span className="eyebrow">Workspace</span><h2 id="working-tabs-title">Working tabs</h2><small>{tabs.length} {tabs.length === 1 ? 'tab' : 'tabs'} open</small></div>
        <button ref={doneRef} type="button" className="tab-switcher-done" onClick={onClose}>Done</button>
      </header>
      <div className="tab-switcher-grid">
        {tabs.map((tab) => (
          <div key={tab.id} className={`tab-switcher-card${tab.id === activeId ? ' active' : ''}`}>
            <button
              type="button"
              className="tab-switcher-card-body"
              aria-current={tab.id === activeId ? 'page' : undefined}
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
