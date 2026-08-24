import { useEffect, useRef } from 'react'
import { BookOpenText, ListPlus, PanelRight, Search, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface GlobalCommandMenuProps {
  open: boolean
  onClose: () => void
  onTogglePanel?: () => void
}

export function GlobalCommandMenu({ open, onClose, onTogglePanel }: GlobalCommandMenuProps) {
  const navigate = useNavigate()
  const firstActionRef = useRef<HTMLButtonElement>(null)
  const sheetRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    firstActionRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return }
      if (event.key !== 'Tab' || !sheetRef.current) return
      const controls = [...sheetRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
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

  const go = (path: string) => {
    navigate(path)
    onClose()
  }

  return (
    <div className="layer-backdrop layer-backdrop-center layer-backdrop-blur command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={sheetRef} className="dialog command-sheet" role="dialog" aria-modal="true" aria-labelledby="command-title">
        <header>
          <div><span className="eyebrow">Create or go</span><h2 id="command-title">What do you want to do?</h2></div>
          <button type="button" className="command-close" aria-label="Close create menu" onClick={onClose}><X size={17} /></button>
        </header>
        <div className="command-actions">
          <button ref={firstActionRef} type="button" onClick={() => go('/?capture=1')}>
            <span className="command-icon command-icon-note"><BookOpenText size={18} /></span>
            <span><strong>Capture a note</strong><small>Write in today’s journal</small></span>
          </button>
          <button type="button" onClick={() => go('/tasks?create=1')}>
            <span className="command-icon command-icon-task"><ListPlus size={18} /></span>
            <span><strong>Add a task</strong><small>Create it in today’s outline</small></span>
          </button>
          <button type="button" onClick={() => go('/search')}>
            <span className="command-icon"><Search size={18} /></span>
            <span><strong>Find anything</strong><small>Search notes and threads</small></span>
          </button>
          {onTogglePanel && (
            <button
              type="button"
              onClick={() => { onTogglePanel(); onClose() }}
            >
              <span className="command-icon"><PanelRight size={18} /></span>
              <span><strong>Toggle context panel</strong><small>Show or hide the right rail (⌘\)</small></span>
            </button>
          )}
        </div>
        <footer><kbd>⌘ ⇧ P</kbd><span>opens this menu</span></footer>
      </section>
    </div>
  )
}
