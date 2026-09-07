const STORAGE_KEY = 'thread.rss-settings'

export const RSS_REFRESH_INTERVALS = [
  { value: 0, label: 'Off' },
  { value: 5 * 60_000, label: 'Every 5 minutes' },
  { value: 15 * 60_000, label: 'Every 15 minutes' },
  { value: 30 * 60_000, label: 'Every 30 minutes' },
  { value: 60 * 60_000, label: 'Every hour' },
] as const

export type RssRefreshInterval = typeof RSS_REFRESH_INTERVALS[number]['value']

export interface RssSettings {
  refreshIntervalMs: RssRefreshInterval
}

export const DEFAULT_RSS_SETTINGS: RssSettings = { refreshIntervalMs: 15 * 60_000 }

function isRssRefreshInterval(value: unknown): value is RssRefreshInterval {
  return RSS_REFRESH_INTERVALS.some((option) => option.value === value)
}

export function getRssSettings(): RssSettings {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return DEFAULT_RSS_SETTINGS
  try {
    const parsed = JSON.parse(raw) as Partial<RssSettings>
    return isRssRefreshInterval(parsed.refreshIntervalMs)
      ? { refreshIntervalMs: parsed.refreshIntervalMs }
      : DEFAULT_RSS_SETTINGS
  } catch {
    return DEFAULT_RSS_SETTINGS
  }
}

export function saveRssSettings(settings: RssSettings): RssSettings {
  const next = isRssRefreshInterval(settings.refreshIntervalMs)
    ? settings
    : DEFAULT_RSS_SETTINGS
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new Event('thread:rss-settings'))
  return next
}

export function rssRefreshLabel(intervalMs: number): string {
  return RSS_REFRESH_INTERVALS.find((option) => option.value === intervalMs)?.label ?? 'Off'
}
