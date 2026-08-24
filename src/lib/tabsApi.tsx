import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type OpenTab = (path: string, options?: { background?: boolean }) => void

const TabsApiContext = createContext<OpenTab | null>(null)

export function useOpenTab(): OpenTab {
  const openTab = useContext(TabsApiContext)
  if (!openTab) throw new Error('useOpenTab must be used within a TabsApiProvider')
  return openTab
}

// Single interception point for every internal link in the app: rail nav,
// thread/wiki links, search results, and the editor's own wiki-link handler
// (MarkdownEditor.tsx) all render `<a href="#/...">`. Capture-phase listeners
// fire outer-to-inner, so this sees cmd/ctrl-clicks before any inner handler
// (e.g. the editor's) does, and stopPropagation keeps them from also firing --
// a plain click falls through untouched.
export function TabsApiProvider({ openTab, children }: { openTab: OpenTab; children: ReactNode }) {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#/"]') : null
      if (!target) return
      event.preventDefault()
      event.stopPropagation()
      openTab(target.getAttribute('href')!.slice(1), { background: true })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [openTab])

  // Touch has no Cmd/Ctrl-click equivalent for "open in background" -- a
  // long-press on a link stands in for it, mirroring how mobile browsers
  // handle the same gesture.
  const [longPressMenu, setLongPressMenu] = useState<{ href: string; x: number; y: number } | null>(null)
  useEffect(() => {
    let pressTimer: number | null = null
    let startX = 0
    let startY = 0
    let firedLongPress = false

    const clearTimer = () => {
      if (pressTimer != null) {
        window.clearTimeout(pressTimer)
        pressTimer = null
      }
    }
    const onTouchStart = (event: TouchEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#/"]') : null
      if (!target) return
      const touch = event.touches[0]
      startX = touch.clientX
      startY = touch.clientY
      firedLongPress = false
      clearTimer()
      const href = target.getAttribute('href')!
      pressTimer = window.setTimeout(() => {
        firedLongPress = true
        setLongPressMenu({ href, x: startX, y: startY })
      }, 550)
    }
    const onTouchMove = (event: TouchEvent) => {
      if (pressTimer == null) return
      const touch = event.touches[0]
      if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > 10) clearTimer()
    }
    const onTouchEnd = (event: TouchEvent) => {
      clearTimer()
      if (!firedLongPress) return
      // The finger was still down when the menu opened -- the browser's own
      // click that follows this touch would otherwise navigate right out
      // from under it.
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#/"]') : null
      if (!target) return
      const suppressClick = (clickEvent: Event) => {
        clickEvent.preventDefault()
        clickEvent.stopPropagation()
        target.removeEventListener('click', suppressClick, true)
      }
      target.addEventListener('click', suppressClick, true)
    }
    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: true })
    document.addEventListener('touchend', onTouchEnd)
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      clearTimer()
    }
  }, [])

  return (
    <TabsApiContext.Provider value={openTab}>
      {children}
      {longPressMenu && (
        <div className="link-context-backdrop" onClick={() => setLongPressMenu(null)} onTouchStart={() => setLongPressMenu(null)}>
          <div
            className="menu-panel link-context-menu"
            style={{ left: Math.min(longPressMenu.x, window.innerWidth - 190), top: longPressMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                openTab(longPressMenu.href.slice(1), { background: true })
                setLongPressMenu(null)
              }}
            >
              Open in New Tab
            </button>
          </div>
        </div>
      )}
    </TabsApiContext.Provider>
  )
}
