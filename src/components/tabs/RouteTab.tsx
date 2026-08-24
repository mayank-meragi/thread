import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { IDockviewPanelHeaderProps } from 'dockview-react'
import { canSplitPanel, moveToNextGroup, splitPanel } from '../../lib/dockviewActions'
import { TODAY_TAB_ID } from '../../lib/tabsModel'
import { TabLabel } from '../TabLabel'
import type { RoutePanelParams } from './RoutePanel'

export function RouteTab({ params, api, containerApi }: IDockviewPanelHeaderProps<RoutePanelParams>) {
  const [isActive, setIsActive] = useState(() => containerApi.activePanel?.id === api.id)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const disposable = containerApi.onDidActivePanelChange(() => {
      setIsActive(containerApi.activePanel?.id === api.id)
    })
    return () => disposable.dispose()
  }, [containerApi, api.id])

  useEffect(() => {
    if (!menu) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [menu])

  const closable = api.id !== TODAY_TAB_ID
  const splittable = canSplitPanel(containerApi, api.id)
  const movable = containerApi.groups.length > 1

  const runAction = (action: () => void) => {
    setMenu(null)
    action()
  }

  return (
    <div
      className={`tab-chip${isActive ? ' active' : ''}`}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenu({ x: event.clientX, y: event.clientY })
      }}
    >
      <button
        type="button"
        className="tab-chip-main"
        onClick={() => api.setActive()}
        onAuxClick={(event) => {
          if (event.button === 1 && closable) {
            event.preventDefault()
            api.close()
          }
        }}
      >
        <span className="tab-chip-label"><TabLabel path={params.path} /></span>
      </button>
      {closable && (
        <button
          type="button"
          className="tap-target-sm tab-chip-close"
          aria-label="Close tab"
          onClick={(event) => {
            event.stopPropagation()
            api.close()
          }}
        >
          <X size={12} />
        </button>
      )}
      {menu &&
        createPortal(
          <>
            <div
              className="link-context-backdrop"
              onMouseDown={() => setMenu(null)}
              onContextMenu={(event) => {
                event.preventDefault()
                setMenu(null)
              }}
            />
            <div
              className="menu-panel link-context-menu"
              role="menu"
              style={{
                left: Math.min(menu.x, window.innerWidth - 200),
                top: Math.min(menu.y, window.innerHeight - 190),
              }}
            >
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                disabled={!splittable}
                title={splittable ? undefined : 'A split needs at least two tabs in this group'}
                onClick={() => runAction(() => void splitPanel(containerApi, api.id, 'right'))}
              >
                Split right
              </button>
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                disabled={!splittable}
                title={splittable ? undefined : 'A split needs at least two tabs in this group'}
                onClick={() => runAction(() => void splitPanel(containerApi, api.id, 'below'))}
              >
                Split below
              </button>
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                disabled={!movable}
                title={movable ? undefined : 'No other group to move this tab to'}
                onClick={() => runAction(() => void moveToNextGroup(containerApi, api.id))}
              >
                Move to next group
              </button>
              {closable && (
                <>
                  <div className="menu-divider link-context-divider" />
                  <button type="button" role="menuitem" className="menu-item" onClick={() => runAction(() => api.close())}>
                    Close tab
                  </button>
                </>
              )}
            </div>
          </>,
          document.body,
        )}
    </div>
  )
}
