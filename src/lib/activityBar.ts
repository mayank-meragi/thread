const ACTIVITY_BAR_PREF_KEY = 'thread.activity-bar'

export function isUserActivityBarHidden(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(ACTIVITY_BAR_PREF_KEY) === 'hidden'
}

export function setUserActivityBarHidden(hidden: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ACTIVITY_BAR_PREF_KEY, hidden ? 'hidden' : 'shown')
  } catch {
    return
  }
}

export function toggleActivityBarHidden(): boolean {
  const next = !isUserActivityBarHidden()
  setUserActivityBarHidden(next)
  return next
}
