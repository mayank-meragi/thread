import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type DockviewTheme } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { getTheme, isDarkTheme } from '../../lib/theme'
import { appendMissing, cycleSelection, loadMru, pruneMru, pushMru, saveMru } from '../../lib/tabMru'
import { applyRailVisibility, ensureContextRail, OPEN_CHAT_EVENT, openChatPanel, toggleContextRail, TOGGLE_RAIL_EVENT } from '../../lib/dockviewActions'
import { isGridGroup, isWorkingPath, tabIdForPath, TODAY_TAB_ID } from '../../lib/tabsModel'
import { TabsApiProvider, type OpenTab } from '../../lib/tabsApi'
import { ContextRail } from './ContextRail'
import { ContextTab } from './ContextTab'
import { ChatPanel } from './ChatPanel'
import { ChatTab } from './ChatTab'
import { RoutePanel } from './RoutePanel'
import { RouteTab } from './RouteTab'
import { GroupActions } from './GroupActions'
import { TabSwitcher, type SwitcherTab } from './TabSwitcher'

const STORAGE_KEY = 'thread.dockview-layout'

const components = { route: RoutePanel, context: ContextRail, chat: ChatPanel }
const tabComponents = { route: RouteTab, context: ContextTab, chat: ChatTab }

interface SwitcherState {
  tabs: SwitcherTab[]
  selected: number
  direction: 1 | -1
}

function addRoutePanel(api: DockviewApi, id: string, path: string, options?: { inactive?: boolean }) {
  const active = api.activeGroup
  const group = active && isGridGroup(active) ? active : api.groups.find(isGridGroup)
  api.addPanel({
    id,
    component: 'route',
    tabComponent: 'route',
    params: { path },
    inactive: options?.inactive,
    position: group ? { referenceGroup: group.id, direction: 'within' } : undefined,
  })
}

function livePanelIds(api: DockviewApi): string[] {
  return api.panels.map((panel) => panel.id)
}

function switcherTabs(api: DockviewApi, order: readonly string[]): SwitcherTab[] {
  const open = livePanelIds(api)
  const seen = new Set<string>()
  const tabs: SwitcherTab[] = []
  for (const id of [...pruneMru(order, new Set(open)), ...open]) {
    if (seen.has(id)) continue
    seen.add(id)
    const panel = api.getPanel(id)
    const path = panel?.params?.path
    if (typeof path === 'string') tabs.push({ id, path })
  }
  return tabs
}

export function DockviewTabs() {
  const location = useLocation()
  const navigate = useNavigate()
  const currentPath = `${location.pathname}${location.search}`
  const [api, setApi] = useState<DockviewApi | null>(null)
  const apiRef = useRef<DockviewApi | null>(null)
  // Set right before a programmatic `setActive()`/`addPanel()` call below, so
  // the resulting `onDidActivePanelChange` (fired synchronously) is
  // recognised as an echo of our own URL -> dockview sync rather than a user
  // tab click, and doesn't bounce back into another `navigate()`.
  const suppressNextActiveChangeRef = useRef(false)
  const mruRef = useRef<string[]>([])
  const mruTimerRef = useRef<number | null>(null)
  const [switcher, setSwitcher] = useState<SwitcherState | null>(null)
  const switcherRef = useRef<SwitcherState | null>(null)
  useEffect(() => {
    switcherRef.current = switcher
  }, [switcher])
  const [dark, setDark] = useState(() => isDarkTheme(getTheme()))

  const dvTheme = useMemo<DockviewTheme>(() => ({
    name: 'thread',
    className: 'dockview-theme-thread',
    colorScheme: dark ? 'dark' : 'light',
    dndTabIndicator: 'line',
    tabGroupIndicator: 'none',
  }), [dark])

  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDarkTheme(getTheme())))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  const saveMruSoon = useCallback(() => {
    if (mruTimerRef.current) window.clearTimeout(mruTimerRef.current)
    mruTimerRef.current = window.setTimeout(() => {
      mruTimerRef.current = null
      saveMru(mruRef.current)
    }, 300)
  }, [])

  const touchMru = useCallback((id: string) => {
    mruRef.current = pushMru(mruRef.current, id)
    saveMruSoon()
  }, [saveMruSoon])

  const onReady = useCallback((event: DockviewReadyEvent) => {
    const dvApi = event.api
    let restored = false
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        dvApi.fromJSON(JSON.parse(saved))
        restored = true
      }
    } catch {
      // Corrupt or incompatible saved layout -- start fresh instead of
      // leaving the dock in a broken state.
    }
    if (!restored) {
      addRoutePanel(dvApi, TODAY_TAB_ID, '/')
    }
    ensureContextRail(dvApi)
    mruRef.current = appendMissing(pruneMru(loadMru(), new Set(livePanelIds(dvApi))), livePanelIds(dvApi))
    const activeId = dvApi.activePanel?.id
    if (activeId) mruRef.current = pushMru(mruRef.current, activeId)
    saveMru(mruRef.current)
    apiRef.current = dvApi
    setApi(dvApi)
  }, [])

  // Persist the open tabs, their order, and the active one -- debounced,
  // since a layout-change event fires on every add/remove/move/activate.
  useEffect(() => {
    if (!api) return
    let timer: number | null = null
    const disposable = api.onDidLayoutChange(() => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        // Self-heal first (recreate/snap-back the context rail) so the healed
        // state is what gets persisted.
        ensureContextRail(api)
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(api.toJSON()))
        } catch {
          // Storage full/unavailable -- persistence is best-effort.
        }
        mruRef.current = pruneMru(mruRef.current, new Set(livePanelIds(api)))
        saveMru(mruRef.current)
      }, 300)
    })
    return () => {
      if (timer) window.clearTimeout(timer)
      disposable.dispose()
    }
  }, [api])

  // URL -> dockview: whenever the route changes (a link click, back/forward,
  // or a wiki-link's direct `location.hash` write), make sure the matching
  // panel exists and is active.
  useEffect(() => {
    if (!api || !isWorkingPath(currentPath)) return
    const id = tabIdForPath(currentPath)
    const existing = api.getPanel(id)
    if (existing) {
      if (existing.params?.path !== currentPath) existing.api.updateParameters({ path: currentPath })
      if (api.activePanel?.id !== id) {
        suppressNextActiveChangeRef.current = true
        existing.api.setActive()
      }
      return
    }
    suppressNextActiveChangeRef.current = true
    addRoutePanel(api, id, currentPath)
  }, [api, currentPath])

  // dockview -> URL: the user clicked a different tab, or closing the active
  // tab made dockview activate an adjacent one -- follow it. Every activation
  // (user click or programmatic navigation) also refreshes the MRU order
  // that powers the Option+Tab switcher.
  useEffect(() => {
    if (!api) return
    const disposable = api.onDidActivePanelChange((event) => {
      const id = event.panel?.id
      if (id) touchMru(id)
      if (suppressNextActiveChangeRef.current) {
        suppressNextActiveChangeRef.current = false
        return
      }
      const path = event.panel?.params?.path as string | undefined
      if (path && path !== currentPath) navigate(path)
    })
    return () => disposable.dispose()
  }, [api, navigate, currentPath, touchMru])

  const openSwitcher = useCallback((direction: 1 | -1) => {
    const current = apiRef.current
    if (!current) return
    const tabs = switcherTabs(current, mruRef.current)
    if (tabs.length < 2) return
    const currentIndex = tabs.findIndex((tab) => tab.id === current.activePanel?.id)
    if (currentIndex > 0) {
      tabs.unshift(...tabs.splice(currentIndex, 1))
    }
    setSwitcher({
      tabs,
      selected: direction === 1 ? Math.min(1, tabs.length - 1) : tabs.length - 1,
      direction,
    })
  }, [])

  const commitSwitcher = useCallback((index?: number) => {
    const state = switcherRef.current
    setSwitcher(null)
    if (!state) return
    const target = state.tabs[index ?? state.selected]
    if (target) navigate(target.path)
  }, [navigate])

  // Firefox-style Option+Tab: press once to preview the previous tab, keep
  // tapping Tab to walk the recency list, release Option (or Enter/click) to
  // switch. Shift reverses direction; Esc cancels without switching.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && event.altKey && !event.metaKey && !event.ctrlKey) {
        event.preventDefault()
        if (!switcher) openSwitcher(event.shiftKey ? -1 : 1)
        else {
          const step = switcher.direction * (event.shiftKey ? -1 : 1)
          setSwitcher({
            ...switcher,
            selected: cycleSelection(switcher.tabs.length, switcher.selected, step),
          })
        }
        return
      }
      if (!switcher) return
      if (event.key === 'Escape') {
        event.preventDefault()
        setSwitcher(null)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        commitSwitcher()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [switcher, openSwitcher, commitSwitcher])

  useEffect(() => {
    if (!switcher) return
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt' || !event.altKey) commitSwitcher()
    }
    const cancel = () => setSwitcher(null)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', cancel)
    }
  }, [switcher, commitSwitcher])

  useEffect(() => {
    const toggle = () => {
      const current = apiRef.current
      if (!current) return
      toggleContextRail(current)
    }
    window.addEventListener(TOGGLE_RAIL_EVENT, toggle)
    return () => window.removeEventListener(TOGGLE_RAIL_EVENT, toggle)
  }, [])

  useEffect(() => {
    const open = () => {
      const current = apiRef.current
      if (current) openChatPanel(current)
    }
    window.addEventListener(OPEN_CHAT_EVENT, open)
    return () => window.removeEventListener(OPEN_CHAT_EVENT, open)
  }, [])

  // Mobile widths hide the rail entirely (replaces the old display:none CSS
  // rule); leaving the breakpoint restores the user's own preference.
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)')
    const onChange = () => {
      const current = apiRef.current
      if (current) applyRailVisibility(current)
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const openTab = useCallback<OpenTab>((path, options) => {
    if (!options?.background) {
      navigate(path)
      return
    }
    const current = apiRef.current
    if (!current) {
      navigate(path)
      return
    }
    const id = tabIdForPath(path)
    const existing = current.getPanel(id)
    if (existing) {
      existing.api.updateParameters({ path })
      return
    }
    addRoutePanel(current, id, path, { inactive: true })
  }, [navigate])

  return (
    <TabsApiProvider openTab={openTab}>
      <DockviewReact
        className="dockview-shell"
        components={components}
        tabComponents={tabComponents}
        rightHeaderActionsComponent={GroupActions}
        disableFloatingGroups
        theme={dvTheme}
        onReady={onReady}
      />
      {switcher && (
        <TabSwitcher
          tabs={switcher.tabs}
          selected={switcher.selected}
          onHighlight={(index) => setSwitcher((state) => (state ? { ...state, selected: index } : state))}
          onCommit={commitSwitcher}
          onCancel={() => setSwitcher(null)}
        />
      )}
    </TabsApiProvider>
  )
}
