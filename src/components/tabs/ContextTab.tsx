import { Button } from 'fiber'
import { useEffect, useState } from 'react'
import type { IDockviewPanelHeaderProps } from 'dockview-react'

export function ContextTab({ api, containerApi }: IDockviewPanelHeaderProps) {
  const [isActive, setIsActive] = useState(() => containerApi.activePanel?.id === api.id)

  useEffect(() => {
    const disposable = containerApi.onDidActivePanelChange(() => {
      setIsActive(containerApi.activePanel?.id === api.id)
    })
    return () => disposable.dispose()
  }, [containerApi, api.id])

  return (
    <div className={`tab-chip${isActive ? ' active' : ''}`}>
      <Button unstyled
        type="button"
        className="tab-chip-main"
        onClick={() => api.setActive()}
      >
        <span className="tab-chip-label">Context</span>
      </Button>
    </div>
  )
}
