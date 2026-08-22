export function isoToday(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

export function shiftDay(date: string, amount: number): string {
  const value = new Date(`${date}T12:00:00`)
  value.setDate(value.getDate() + amount)
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): string[] {
  const dates: string[] = []
  let cursor = from
  while (cursor <= to) {
    dates.push(cursor)
    cursor = shiftDay(cursor, 1)
  }
  return dates
}

export function formatDay(date: string): { weekday: string; full: string; short: string } {
  const value = new Date(`${date}T12:00:00`)
  return {
    weekday: new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(value),
    full: new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(value),
    short: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(value),
  }
}

export function formatShortDate(date: string): string {
  const value = new Date(`${date}T12:00:00`)
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(value)
}
