const STORAGE_KEY = 'thread.mru-tabs'

export type MruOrder = readonly string[]

export function pushMru(order: MruOrder, id: string): string[] {
  return [id, ...order.filter((existing) => existing !== id)]
}

export function pruneMru(order: MruOrder, openIds: ReadonlySet<string>): string[] {
  return order.filter((id) => openIds.has(id))
}

export function appendMissing(order: MruOrder, openIds: readonly string[]): string[] {
  const known = new Set(order)
  return [...order, ...openIds.filter((id) => !known.has(id))]
}

export function cycleSelection(length: number, index: number, delta: number): number {
  if (length <= 0) return 0
  const next = (index + delta) % length
  return next < 0 ? next + length : next
}

export function loadMru(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

export function saveMru(order: MruOrder): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...order]))
  } catch {
    return
  }
}
