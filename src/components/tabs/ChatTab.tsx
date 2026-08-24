import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { IDockviewPanelHeaderProps } from 'dockview-react'

export function ChatTab({ api, containerApi }: IDockviewPanelHeaderProps) {
  const [isActive, setIsActive] = useState(() => containerApi.activePanel?.id === api.id)

  useEffect(() => {
    const disposable = containerApi.onDidActivePanelChange(() => {
      setIsActive(containerApi.activePanel?.id === api.id)
    })
    return () => disposable.dispose()
  }, [containerApi, api.id])

  return (
    <div
      className={`tab-chip${isActive ? ' active' : ''}`}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault()
          api.close()
        }
      }}
    >
      <button
        type="button"
        className="tab-chip-main"
        onClick={() => api.setActive()}
      >
        <span className="tab-chip-label">Chat</span>
      </button>
      <button
        type="button"
        className="tab-chip-close"
        aria-label="Close chat panel"
        onClick={(event) => {
          event.stopPropagation()
          api.close()
        }}
      >
        <X size={12} />
      </button>
    </div>
  )
}
