import { useEffect, useRef, type RefObject } from 'react'

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface ManagedLayerOptions {
  closeOnEscape?: boolean
  focusOnOpen?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  returnFocus?: boolean
  trapFocus?: boolean
}

/** Shared Escape, focus-return, and optional focus-trap behavior for layers. */
export function useManagedLayer(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  onClose: (() => void) | undefined,
  {
    closeOnEscape = true,
    focusOnOpen = true,
    initialFocusRef,
    returnFocus = true,
    trapFocus = true,
  }: ManagedLayerOptions = {},
) {
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  const initialFocusRefRef = useRef(initialFocusRef)

  useEffect(() => {
    onCloseRef.current = onClose
    initialFocusRefRef.current = initialFocusRef
  }, [initialFocusRef, onClose])

  useEffect(() => {
    if (!open) return

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    let frame = 0

    if (focusOnOpen) {
      frame = window.requestAnimationFrame(() => {
        const root = rootRef.current
        const explicitTarget = initialFocusRefRef.current?.current
        const markedTarget = root?.querySelector<HTMLElement>('[data-layer-initial-focus], [autofocus]')
        const firstTarget = root?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
        ;(explicitTarget ?? markedTarget ?? firstTarget ?? root)?.focus()
      })
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const root = rootRef.current
      if (!root) return

      if (event.key === 'Escape' && closeOnEscape) {
        event.preventDefault()
        onCloseRef.current?.()
        return
      }

      if (!trapFocus || event.key !== 'Tab') return

      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.getAttribute('aria-hidden') !== 'true',
      )

      if (focusable.length === 0) {
        event.preventDefault()
        root.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      if (returnFocus && previousFocusRef.current?.isConnected) previousFocusRef.current.focus()
      previousFocusRef.current = null
    }
  }, [closeOnEscape, focusOnOpen, open, returnFocus, rootRef, trapFocus])
}
