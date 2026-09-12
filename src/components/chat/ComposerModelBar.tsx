import { Button, MenuItem, ToggleButton } from 'fiber'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronDown, Sparkles } from 'lucide-react'
import {
  hasProviderKey,
  setActiveModel,
  setEffort,
  useAIConfig,
  type AIProvider,
  type ThinkingEffort,
} from '../../lib/ai'
import { PROVIDER_IDS, findModel, modelLabel, useModels } from '../../lib/aiModels'

const PROVIDER_ORDER: AIProvider[] = PROVIDER_IDS
const EFFORTS: { value: ThinkingEffort; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
]

function effortLabel(effort: ThinkingEffort): string {
  return EFFORTS.find((option) => option.value === effort)?.label ?? 'Off'
}

// Quiet model + thinking-effort switcher in the chat composer's bottom row. One
// trigger (model name, current thinking level inline, chevron) opening one
// popover that holds both the model list and a "Thinking" footer. Drives the
// single global AIConfig -- whatever is picked here is what every persona and
// session uses.
export function ComposerModelBar() {
  const config = useAIConfig()
  const models = useModels()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onOutside = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const anyKey = config ? PROVIDER_ORDER.some((provider) => hasProviderKey(config, provider)) : false

  if (!config || !anyKey) {
    return (
      <div className="composer-model-bar">
        <Link to="/settings?section=ai" className="composer-model-setup">
          <Sparkles size={13} /> Set up AI
        </Link>
      </div>
    )
  }

  const reasoning = Boolean(findModel(config.provider, config.model)?.reasoning)

  return (
    <div className="composer-model-bar" ref={wrapRef}>
      <Button unstyled
        type="button"
        className="composer-model-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="composer-model-name">{modelLabel(config.provider, config.model)}</span>
        {reasoning && <span className="composer-model-effort">{effortLabel(config.effort)}</span>}
        <ChevronDown size={12} />
      </Button>
      {open && (
        <div className="menu-panel composer-model-panel" role="listbox" aria-label="Model">
          <div className="composer-model-list">
            {PROVIDER_ORDER.flatMap((provider) => {
              const enabled = hasProviderKey(config, provider)
              const seen = new Set<string>()
              return models
                .filter((option) => option.provider === provider && option.id.trim() && !seen.has(option.id) && seen.add(option.id))
                .map((option) => {
                  const isActive = provider === config.provider && option.id === config.model
                  return (
                    <MenuItem
                      key={`${provider}:${option.id}`}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      disabled={!enabled}
                      className={isActive ? 'composer-model-option active' : 'composer-model-option'}
                      onClick={() => {
                        setActiveModel(provider, option.id)
                        setOpen(false)
                      }}
                    >
                      <span>{option.label}</span>
                      {isActive ? <Check size={13} /> : !enabled ? <span className="composer-model-lock">Add key in Settings</span> : null}
                    </MenuItem>
                  )
                })
            })}
          </div>
          {reasoning && (
            <div className="composer-thinking-row" role="group" aria-label="Thinking effort">
              <span>Thinking</span>
              <div className="composer-thinking-options">
                {EFFORTS.map((effort) => (
                  <ToggleButton unstyled
                    key={effort.value}
                    pressed={config.effort === effort.value}
                    className={config.effort === effort.value ? 'is-active' : ''}
                    onClick={() => setEffort(effort.value)}
                  >
                    {effort.label}
                  </ToggleButton>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
