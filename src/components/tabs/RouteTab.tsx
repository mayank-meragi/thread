import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { IDockviewPanelHeaderProps } from 'dockview-react'
import { TODAY_TAB_ID } from '../../lib/tabsModel'
import { TabLabel } from '../TabLabel'
import type { RoutePanelParams } from './RoutePanel'

export function RouteTab({ params, api, containerApi }: IDockviewPanelHeaderProps<RoutePanelParams>) {
  const [isActive, setIsActive] = useState(() => containerApi.activePanel?.id === api.id)

  useEffect(() => {
    const disposable = containerApi.onDidActivePanelChange(() => {
      setIsActive(containerApi.activePanel?.id === api.id)
    })
    return () => disposable.dispose()
  }, [containerApi, api.id])

  const closable = api.id !== TODAY_TAB_ID

  return (
    <div className={`tab-chip${isActive ? ' active' : ''}`}>
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
          className="tab-chip-close"
          aria-label="Close tab"
          onClick={(event) => {
            event.stopPropagation()
            api.close()
          }}
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}
