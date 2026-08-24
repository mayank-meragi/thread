import type { DayRecord } from '../db'
import { cleanMarkdownLine } from './outline'

export interface DaySearchHit {
  date: string
  markdown: string
  matchLine: string
}

export function searchDays(days: DayRecord[], normalizedQuery: string): DaySearchHit[] {
  if (!normalizedQuery) return []
  return days
    .filter((day) => day.markdown.toLocaleLowerCase().includes(normalizedQuery))
    .map((day) => ({
      date: day.date,
      markdown: day.markdown,
      matchLine: cleanMarkdownLine(day.markdown.split('\n').find((line) => line.toLocaleLowerCase().includes(normalizedQuery)) ?? ''),
    }))
}
