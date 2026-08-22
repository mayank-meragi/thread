export const TODAY_TAB_ID = 'today'

const STATIC_TAB_PATHS = ['/tasks', '/search', '/settings']

export function isWorkingPath(path: string): boolean {
  const pathname = path.split('?')[0] || '/'
  return pathname === '/' || pathname.startsWith('/thread/') || STATIC_TAB_PATHS.includes(pathname)
}

export function tabIdForPath(path: string): string {
  const pathname = path.split('?')[0] || '/'
  return pathname === '/' ? TODAY_TAB_ID : pathname
}
