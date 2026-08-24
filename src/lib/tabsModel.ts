import type { DockviewGroupPanel } from 'dockview-react'

export const TODAY_TAB_ID = 'today'

export const CONTEXT_PANEL_ID = 'context-panel'
export const CONTEXT_GROUP_ID = 'context-rail'
export type EdgePosition = 'left' | 'right'
export const CONTEXT_RAIL_POSITION: EdgePosition = 'right'

export const CHAT_PANEL_ID = 'chat-panel'

const STATIC_TAB_PATHS = ['/tasks', '/search', '/settings']

export function isWorkingPath(path: string): boolean {
  const pathname = path.split('?')[0] || '/'
  return pathname === '/' || pathname.startsWith('/thread/') || STATIC_TAB_PATHS.includes(pathname)
}

export function tabIdForPath(path: string): string {
  const pathname = path.split('?')[0] || '/'
  return pathname === '/' ? TODAY_TAB_ID : pathname
}

export function isGridGroup(group: DockviewGroupPanel): boolean {
  return group.api.location.type === 'grid'
}
