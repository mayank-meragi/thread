import { useRef, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'

export interface TabOption {
  value: string
  label: ReactNode
  disabled?: boolean
}

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  options: readonly TabOption[]
  value: string
  onValueChange?: (value: string) => void
  panelId?: string
  idPrefix?: string
  getTabId?: (value: string) => string
  getPanelId?: (value: string) => string
  density?: 'compact' | 'default' | 'comfortable'
}

/** Semantic tablist with one tabbable tab and predictable arrow-key movement. */
export function Tabs({
  options,
  value,
  onValueChange,
  panelId,
  idPrefix = 'tab',
  getTabId,
  getPanelId,
  density,
  className,
  ...rest
}: TabsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled)
  const firstEnabled = options.findIndex((option) => !option.disabled)
  const tabIndexFor = (index: number) => index === (selectedIndex >= 0 ? selectedIndex : firstEnabled) ? 0 : -1

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    const enabledIndexes = options.map((option, optionIndex) => option.disabled ? -1 : optionIndex).filter((optionIndex) => optionIndex >= 0)
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const nextIndex = event.key === 'Home' ? enabledIndexes[0] : enabledIndexes[enabledIndexes.length - 1]
      if (nextIndex !== undefined) {
        onValueChange?.(options[nextIndex].value)
        refs.current[nextIndex]?.focus()
      }
      return
    }
    if (!direction || enabledIndexes.length < 2) return
    event.preventDefault()
    const currentPosition = Math.max(0, enabledIndexes.indexOf(index))
    const nextPosition = (currentPosition + direction + enabledIndexes.length) % enabledIndexes.length
    const nextIndex = enabledIndexes[nextPosition]
    onValueChange?.(options[nextIndex].value)
    refs.current[nextIndex]?.focus()
  }

  return (
    <div className={['tabs', className].filter(Boolean).join(' ')} {...rest} role="tablist" data-density={density}>
      {options.map((option, index) => {
        const tabId = getTabId?.(option.value) ?? `${idPrefix}-${option.value}`
        const controlsId = getPanelId?.(option.value) ?? panelId
        return (
          <button
            key={option.value}
            ref={(element) => { refs.current[index] = element }}
            type="button"
            role="tab"
            id={tabId}
            aria-controls={controlsId}
            aria-selected={value === option.value}
            tabIndex={tabIndexFor(index)}
            disabled={option.disabled}
            onClick={() => onValueChange?.(option.value)}
            onKeyDown={(event) => move(event, index)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
