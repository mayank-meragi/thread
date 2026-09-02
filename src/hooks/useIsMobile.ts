import { useEffect, useState } from 'react'

// Matches the `@media (max-width: 760px)` breakpoint used across the app's CSS
// and the `RAIL_MOBILE_QUERY` in src/lib/dockviewActions.ts. Several call sites
// still inline their own `matchMedia` -- new code should use this hook.
const MOBILE_QUERY = '(max-width: 760px)'

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches,
  )

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setIsMobile(query.matches)
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
