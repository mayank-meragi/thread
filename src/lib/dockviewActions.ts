import type { DockviewApi } from 'dockview-react'
import { CHAT_PANEL_ID, CONTEXT_GROUP_ID, CONTEXT_PANEL_ID, CONTEXT_RAIL_POSITION, isGridGroup, type EdgePosition } from './tabsModel'

export type SplitDirection = 'right' | 'below'

const RAIL_PREF_KEY = 'thread.context-rail'
const RAIL_MOBILE_QUERY = '(max-width: 760px)'
export const TOGGLE_RAIL_EVENT = 'thread:toggle-context-rail'
export const RAIL_VISIBILITY_EVENT = 'thread:context-rail-visibility'
export const OPEN_CHAT_EVENT = 'thread:open-chat-panel'

function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(RAIL_MOBILE_QUERY).matches
}

export function isUserRailHidden(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(RAIL_PREF_KEY) === 'hidden'
}

function setUserRailHidden(hidden: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RAIL_PREF_KEY, hidden ? 'hidden' : 'shown')
  } catch {
    return
  }
}

export function applyRailVisibility(api: DockviewApi): void {
  const desired = !isUserRailHidden() && !isMobileViewport()
  if (api.isEdgeGroupVisible(CONTEXT_RAIL_POSITION) !== desired) {
    api.setEdgeGroupVisible(CONTEXT_RAIL_POSITION, desired)
  }
}

export function toggleContextRail(api: DockviewApi): void {
  setUserRailHidden(!isUserRailHidden())
  applyRailVisibility(api)
  window.dispatchEvent(new CustomEvent(RAIL_VISIBILITY_EVENT, { detail: { hidden: isUserRailHidden() } }))
}

// The context rail must always exist as the right edge group. Restores after
// old layouts (pre-rail), recreates it if somehow closed, and snaps the panel
// back if it was dragged into the editor grid.
export function ensureContextRail(api: DockviewApi, railWidth?: number): void {
  const panel = api.getPanel(CONTEXT_PANEL_ID)
  const detached = Boolean(panel && (panel.group.id !== CONTEXT_GROUP_ID || panel.group.api.location.type !== 'edge'))
  if (!panel || detached) {
    if (!api.getEdgeGroup(CONTEXT_RAIL_POSITION)) {
      api.addEdgeGroup(CONTEXT_RAIL_POSITION, {
        id: CONTEXT_GROUP_ID,
        initialSize: railWidth ?? 320,
        minimumSize: 260,
        maximumSize: 480,
      })
    }
    if (panel) {
      const group = api.groups.find((candidate) => candidate.id === CONTEXT_GROUP_ID)
      if (group) panel.api.moveTo({ group, index: 0, skipSetActive: true })
    } else {
      api.addPanel({
        id: CONTEXT_PANEL_ID,
        component: 'context',
        tabComponent: 'context',
        params: {},
        inactive: true,
        position: { referenceGroup: CONTEXT_GROUP_ID, direction: 'within' },
      })
    }
  }
  // Old saved layouts restore a right-edge group with its vertical header;
  // normalize to the horizontal strip used across the app.
  const edgeApi = api.getEdgeGroup(CONTEXT_RAIL_POSITION)
  if (edgeApi && edgeApi.getHeaderPosition() !== 'top') edgeApi.setHeaderPosition('top')
  applyRailVisibility(api)
}

// The chat panel lives as a second tab in the context rail's edge group, but
// unlike the context panel it isn't shown by default -- it only exists once
// opened, and stays inactive (behind Context) otherwise.
export function ensureChatPanel(api: DockviewApi): void {
  if (api.getPanel(CHAT_PANEL_ID)) return
  const group = api.groups.find((candidate) => candidate.id === CONTEXT_GROUP_ID)
  api.addPanel({
    id: CHAT_PANEL_ID,
    component: 'chat',
    tabComponent: 'chat',
    params: {},
    inactive: true,
    position: group ? { referenceGroup: group.id, direction: 'within' } : undefined,
  })
}

// The icon-rail entry point: force the rail visible (even if the user hid it)
// and bring Chat to the front, regardless of which tab was showing before.
export function openChatPanel(api: DockviewApi): void {
  ensureChatPanel(api)
  if (isUserRailHidden()) toggleContextRail(api)
  else applyRailVisibility(api)
  api.getPanel(CHAT_PANEL_ID)?.api.setActive()
}

export function canSplitPanel(api: DockviewApi, panelId: string): boolean {
  const panel = api.getPanel(panelId)
  return Boolean(panel && panel.group.panels.length > 1 && isGridGroup(panel.group))
}

export function splitPanel(api: DockviewApi, panelId: string, direction: SplitDirection): boolean {
  const panel = api.getPanel(panelId)
  if (!panel || !isGridGroup(panel.group) || panel.group.panels.length < 2) return false
  const target = api.addGroup({ referenceGroup: panel.group, direction })
  panel.api.moveTo({ group: target })
  return true
}

export function moveToNextGroup(api: DockviewApi, panelId: string): boolean {
  const panel = api.getPanel(panelId)
  const groups = api.groups.filter(isGridGroup)
  if (!panel || groups.length < 2) return false
  const index = groups.indexOf(panel.group)
  const target = groups[(index + 1) % groups.length]
  panel.api.moveTo({ group: target, index: target.panels.length })
  return true
}

export type { EdgePosition }
