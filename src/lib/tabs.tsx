import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export interface Tab {
  id: string
  path: string
  closable: boolean
}

interface TabsContextValue {
  tabs: Tab[]
  mountedIds: string[]
  activeId: string
  openTab: (path: string, options?: { background?: boolean }) => void
  activateTab: (id: string) => void
  closeTab: (id: string) => void
}

const TabsContext = createContext<TabsContextValue | null>(null)

const MAX_MOUNTED = 6
export const TODAY_TAB_ID = 'today'

// One tab per distinct page -- except Today, which is a singleton (the app
// only ever has one "current day" view; jumping to a different day's source
// line updates that one tab's remembered path instead of spawning another).
function tabIdForPath(path: string): string {
  const pathname = path.split('?')[0] || '/'
  return pathname === '/' ? TODAY_TAB_ID : pathname
}

function makeInitialTabs(initialPath: string): Tab[] {
  const id = tabIdForPath(initialPath)
  const today: Tab = { id: TODAY_TAB_ID, path: id === TODAY_TAB_ID ? initialPath : '/', closable: false }
  if (id === TODAY_TAB_ID) return [today]
  return [today, { id, path: initialPath, closable: true }]
}

export function TabsProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const currentPath = `${location.pathname}${location.search}`
  const [tabs, setTabs] = useState<Tab[]>(() => makeInitialTabs(currentPath))
  const [activeId, setActiveId] = useState(() => tabIdForPath(currentPath))
  const [mountedIds, setMountedIds] = useState<string[]>(() => makeInitialTabs(currentPath).map((tab) => tab.id))
  const [syncedPath, setSyncedPath] = useState(currentPath)
  const tabsRef = useRef(tabs)

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  // Real browser navigation (Link clicks, back/forward, useNavigate calls
  // elsewhere in the app) is the single source of truth for "where am I" --
  // tabs just mirror it. Adjusting state during render (rather than in an
  // effect) when the location has changed since the last render avoids an
  // extra cascading-render pass: https://react.dev/learn/you-might-not-need-an-effect
  if (currentPath !== syncedPath) {
    setSyncedPath(currentPath)
    const id = tabIdForPath(currentPath)
    setTabs((prev) => {
      const existing = prev.find((tab) => tab.id === id)
      if (existing) {
        if (existing.path === currentPath) return prev
        return prev.map((tab) => (tab.id === id ? { ...tab, path: currentPath } : tab))
      }
      return [...prev, { id, path: currentPath, closable: id !== TODAY_TAB_ID }]
    })
    setActiveId(id)
    setMountedIds((prev) => {
      const next = [...prev.filter((existingId) => existingId !== id), id]
      return next.length > MAX_MOUNTED ? next.slice(next.length - MAX_MOUNTED) : next
    })
  }

  const openTab = useCallback((path: string, options?: { background?: boolean }) => {
    const id = tabIdForPath(path)
    if (!options?.background) {
      navigate(path)
      return
    }
    // A background tab is just a strip entry with a remembered destination
    // until it's actually selected -- it doesn't get mounted (and so isn't
    // subject to LRU eviction) until then.
    setTabs((prev) => {
      const existing = prev.find((tab) => tab.id === id)
      if (existing) return prev.map((tab) => (tab.id === id ? { ...tab, path } : tab))
      return [...prev, { id, path, closable: id !== TODAY_TAB_ID }]
    })
  }, [navigate])

  const activateTab = useCallback((id: string) => {
    const tab = tabsRef.current.find((candidate) => candidate.id === id)
    if (tab) navigate(tab.path)
  }, [navigate])

  const closeTab = useCallback((id: string) => {
    if (id === TODAY_TAB_ID) return
    const wasActive = activeId === id
    const remaining = tabsRef.current.filter((tab) => tab.id !== id)
    setTabs(remaining)
    setMountedIds((prev) => prev.filter((existingId) => existingId !== id))
    if (wasActive) {
      const fallback = remaining.at(-1) ?? { path: '/' }
      navigate(fallback.path)
    }
  }, [activeId, navigate])

  const value = useMemo<TabsContextValue>(
    () => ({ tabs, mountedIds, activeId, openTab, activateTab, closeTab }),
    [tabs, mountedIds, activeId, openTab, activateTab, closeTab],
  )

  // Single interception point for every internal link in the app: sidebar
  // nav, thread/wiki links, search results, and the editor's own wiki-link
  // handler (MarkdownEditor.tsx) all render `<a href="#/...">`. Capture-phase
  // listeners fire outer-to-inner, so this sees cmd/ctrl-clicks before any
  // inner handler (e.g. the editor's) does, and stopPropagation keeps them
  // from also firing -- a plain click falls through untouched.
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

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>
}

export function useTabs(): TabsContextValue {
  const context = useContext(TabsContext)
  if (!context) throw new Error('useTabs must be used within a TabsProvider')
  return context
}
