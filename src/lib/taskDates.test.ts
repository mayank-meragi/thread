import { describe, expect, it } from 'vitest'
import { parseTaskDate } from './taskDates'

describe('task date parsing', () => {
  it('uses the journal day as the reference for weekdays', () => {
    expect(parseTaskDate('Fix this by Monday', '2026-08-19')).toMatchObject({
      dueDate: '2026-08-24',
      matchedText: 'Monday',
    })
  })

  it('understands relative dates in complete task text', () => {
    expect(parseTaskDate('Send the draft tomorrow', '2026-08-19')).toMatchObject({
      dueDate: '2026-08-20',
      matchedText: 'tomorrow',
    })
  })

  it('returns null when Chrono finds no date', () => {
    expect(parseTaskDate('Finalize omnibox commands', '2026-08-19')).toBeNull()
  })
})
