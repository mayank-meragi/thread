import * as chrono from 'chrono-node'

export interface ParsedTaskDate {
  dueDate: string
  matchedText: string
  index: number
}

export function parseTaskDate(text: string, journalDay: string): ParsedTaskDate | null {
  const reference = new Date(`${journalDay}T12:00:00`)
  const result = chrono.casual.parse(text, reference, { forwardDate: true })[0]
  if (!result) return null
  const date = result.start.date()
  return {
    dueDate: [date.getFullYear(), `${date.getMonth() + 1}`.padStart(2, '0'), `${date.getDate()}`.padStart(2, '0')].join('-'),
    matchedText: result.text,
    index: result.index,
  }
}

// The NLP date parser picks up phrases like "today"/"next friday" inline in
// the task text -- once that's captured as the due date, showing it again in
// the task label is redundant clutter, so cut just the matched span out.
export function stripMatchedText(text: string, detected: ParsedTaskDate): string {
  const before = text.slice(0, detected.index)
  const after = text.slice(detected.index + detected.matchedText.length)
  return `${before}${after}`.replace(/\s{2,}/g, ' ').trim()
}
