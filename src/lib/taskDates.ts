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
