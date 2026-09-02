import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { animated, useSpring } from '@react-spring/web'
import { useDrag } from '@use-gesture/react'
import { MessageSquare, PanelRight, X } from 'lucide-react'
import { useIsMobile } from '../../hooks/useIsMobile'
import { ContextRail } from '../tabs/ContextRail'
import { ChatPanel } from '../tabs/ChatPanel'

type DrawerTab = 'context' | 'chat'

// Fraction of the panel width past which a release commits the open/close, and
// the flick velocity (px/ms) that commits regardless of distance.
const COMMIT_FRACTION = 0.4
const FLICK_VELOCITY = 0.35

function drawerWidth(): number {
  if (typeof window === 'undefined') return 360
  return Math.min(360, Math.round(window.innerWidth * 0.88))
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/**
 * Mobile-only right-edge drawer. The context rail and chat panel are otherwise
 * unreachable below 760px (the dockview edge group is force-hidden and the
 * ActivityBar that opens chat is display:none). Drag in from the right screen
 * edge to pull the drawer open; it tracks the finger and snaps on release.
 */
export function MobileRailDrawer() {
  const isMobile = useIsMobile()
  const { pathname } = useLocation()
  const [width, setWidth] = useState(() => drawerWidth())
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [tab, setTab] = useState<DrawerTab>('context')
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])

  // x is the panel's translateX: `width` = fully closed (off-screen right),
  // 0 = fully open.
  const [{ x }, api] = useSpring(() => ({ x: drawerWidth(), config: { tension: 320, friction: 34 } }))

  const settle = useCallback(
    (next: boolean) => {
      setDragging(false)
      setOpen(next)
      api.start({ x: next ? 0 : width, immediate: prefersReducedMotion() })
    },
    [api, width],
  )

  // Keep the resting position in sync with viewport/orientation changes while
  // the drawer is closed.
  useEffect(() => {
    const onResize = () => {
      const next = drawerWidth()
      setWidth(next)
      if (!openRef.current) api.start({ x: next, immediate: true })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [api])

  // Close on route change (e.g. a thread link inside the rail was followed).
  useEffect(() => {
    if (openRef.current) settle(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  // Growing past the mobile breakpoint hands control back to the desktop
  // dockview rail. Reset the React state during render (the switching-key
  // pattern) so a returning viewport starts closed and the body-scroll lock
  // below can clear; the spring is snapped shut separately as an external
  // system.
  const [wasMobile, setWasMobile] = useState(isMobile)
  if (wasMobile !== isMobile) {
    setWasMobile(isMobile)
    if (!isMobile) {
      setOpen(false)
      setDragging(false)
    }
  }
  useEffect(() => {
    if (!isMobile) api.start({ x: drawerWidth(), immediate: true })
  }, [isMobile, api])

  // Lock body scroll and close on Escape while open.
  useEffect(() => {
    if (!open || !isMobile) return
    document.body.classList.add('mobile-rail-drawer-lock')
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') settle(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.classList.remove('mobile-rail-drawer-lock')
      window.removeEventListener('keydown', onKey)
    }
  }, [open, isMobile, settle])

  // Drag in from the right edge to open. movement.x is negative leftward.
  const bindEdge = useDrag(
    ({ last, movement: [mx], velocity: [vx], direction: [dx] }) => {
      if (last) {
        const commit = -mx > width * COMMIT_FRACTION || (vx > FLICK_VELOCITY && dx < 0)
        settle(commit)
        return
      }
      setDragging(true)
      api.start({ x: clamp(width + mx, 0, width), immediate: true })
    },
    { axis: 'x', filterTaps: true },
  )

  // Drag the header rightward to close.
  const bindHandle = useDrag(
    ({ last, movement: [mx], velocity: [vx], direction: [dx] }) => {
      if (last) {
        const commit = mx > width * COMMIT_FRACTION || (vx > FLICK_VELOCITY && dx > 0)
        settle(!commit)
        return
      }
      setDragging(true)
      api.start({ x: clamp(mx, 0, width), immediate: true })
    },
    { axis: 'x', filterTaps: true },
  )

  if (!isMobile) return null

  const overlayVisible = open || dragging

  return (
    <>
      <div
        {...bindEdge()}
        className="mobile-rail-edge"
        aria-hidden="true"
        style={{ touchAction: 'pan-y' }}
      />

      {overlayVisible && (
        <animated.div
          className="mobile-rail-scrim"
          style={{ opacity: x.to([0, width], [1, 0], 'clamp') }}
          onClick={() => settle(false)}
        />
      )}

      <animated.aside
        className="mobile-rail-panel"
        role="dialog"
        aria-modal={open || undefined}
        aria-label="Context and chat"
        aria-hidden={overlayVisible ? undefined : true}
        style={{
          width,
          transform: x.to((value) => `translate3d(${value}px, 0, 0)`),
          visibility: x.to((value) => (value >= width ? 'hidden' : 'visible')),
        }}
      >
        <header {...bindHandle()} className="mobile-rail-head" style={{ touchAction: 'pan-y' }}>
          <div className="mobile-rail-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'context'}
              className={tab === 'context' ? 'is-active' : ''}
              onClick={() => setTab('context')}
            >
              <PanelRight size={14} aria-hidden="true" /> Context
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'chat'}
              className={tab === 'chat' ? 'is-active' : ''}
              onClick={() => setTab('chat')}
            >
              <MessageSquare size={14} aria-hidden="true" /> Chat
            </button>
          </div>
          <button
            type="button"
            className="mobile-rail-close"
            aria-label="Close panel"
            onClick={() => settle(false)}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="mobile-rail-body">
          {tab === 'context' ? <ContextRail /> : <ChatPanel />}
        </div>
      </animated.aside>
    </>
  )
}
