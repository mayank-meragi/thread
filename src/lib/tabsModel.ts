export const TODAY_TAB_ID = 'today'

export function isWorkingPath(path: string): boolean {
  const pathname = path.split('?')[0] || '/'
  return pathname === '/' || pathname.startsWith('/thread/')
}

export function tabIdForPath(path: string): string {
  const pathname = path.split('?')[0] || '/'
  return pathname === '/' ? TODAY_TAB_ID : pathname
}
