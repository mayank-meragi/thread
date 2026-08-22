import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { DockviewReact, themeLight, type DockviewApi, type DockviewReadyEvent } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { isWorkingPath, tabIdForPath, TODAY_TAB_ID } from '../../lib/tabsModel'
import { TabsApiProvider, type OpenTab } from '../../lib/tabsApi'
import { RoutePanel } from './RoutePanel'
import { RouteTab } from './RouteTab'

const STORAGE_KEY = 'thread.dockview-layout'

const components = { route: RoutePanel }
const tabComponents = { route: RouteTab }

function addRoutePanel(api: DockviewApi, id: string, path: string, options?: { inactive?: boolean }) {
  const group = api.groups[0]
  api.addPanel({
    id,
    component: 'route',
    tabComponent: 'route',
    params: { path },
    inactive: options?.inactive,
    position: group ? { referenceGroup: group.id, direction: 'within' } : undefined,
  })
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
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(api.toJSON()))
        } catch {
          // Storage full/unavailable -- persistence is best-effort.
        }
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
  // tab made dockview activate an adjacent one -- follow it.
  useEffect(() => {
    if (!api) return
    const disposable = api.onDidActivePanelChange((event) => {
      if (suppressNextActiveChangeRef.current) {
        suppressNextActiveChangeRef.current = false
        return
      }
      const path = event.panel?.params?.path as string | undefined
      if (path && path !== currentPath) navigate(path)
    })
    return () => disposable.dispose()
  }, [api, navigate, currentPath])

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
        defaultRenderer="always"
        disableDnd
        disableFloatingGroups
        theme={themeLight}
        onReady={onReady}
      />
    </TabsApiProvider>
  )
}
