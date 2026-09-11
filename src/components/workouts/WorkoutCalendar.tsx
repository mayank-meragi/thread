import { ChevronLeft, ChevronRight } from 'lucide-react'
import { shiftDay } from '../../lib/dates'
import { workoutLensState } from '../../lib/workouts/presentation'
import type { WorkoutView } from '../../lib/workouts/types'
import { Button } from '../ui'

function monthStart(month: string): string {
  return `${month}-01`
}

function shiftMonth(month: string, amount: number): string {
  const value = new Date(`${month}-01T12:00:00`)
  value.setMonth(value.getMonth() + amount)
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 7)
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(`${month}-01T12:00:00`))
}

function dayLabel(day: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${day}T12:00:00`))
}

export function WorkoutCalendar({
  month,
  selectedDay,
  workouts,
  onMonthChange,
  onDayChange,
}: {
  month: string
  selectedDay?: string
  workouts: readonly WorkoutView[]
  onMonthChange: (month: string) => void
  onDayChange: (day?: string) => void
}) {
  const first = monthStart(month)
  const firstDate = new Date(`${first}T12:00:00`)
  const mondayOffset = (firstDate.getDay() + 6) % 7
  const gridStart = shiftDay(first, -mondayOffset)
  const days = Array.from({ length: 42 }, (_, index) => shiftDay(gridStart, index))
  const workoutsByDay = new Map<string, WorkoutView[]>()
  for (const workout of workouts) workoutsByDay.set(workout.task.day, [...(workoutsByDay.get(workout.task.day) ?? []), workout])

  return (
    <section className="workout-calendar" aria-label="Workout calendar">
      <header>
        <Button variant="ghost" size="sm" iconOnly aria-label="Previous month" onClick={() => onMonthChange(shiftMonth(month, -1))}><ChevronLeft size={18} /></Button>
        <h2>{monthLabel(month)}</h2>
        <Button variant="ghost" size="sm" iconOnly aria-label="Next month" onClick={() => onMonthChange(shiftMonth(month, 1))}><ChevronRight size={18} /></Button>
      </header>
      <div className="workout-calendar-weekdays" aria-hidden="true">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="workout-calendar-grid">
        {days.map((day) => {
          const items = workoutsByDay.get(day) ?? []
          const outside = !day.startsWith(month)
          const selected = selectedDay === day
          const completed = items.filter((item) => workoutLensState(item) === 'completed').length
          const active = items.some((item) => workoutLensState(item) === 'active')
          const status = active ? 'active' : completed ? 'completed' : items.length ? 'planned' : undefined
          return (
            <button
              type="button"
              key={day}
              className={`workout-calendar-day${outside ? ' outside' : ''}${selected ? ' selected' : ''}${status ? ` has-${status}` : ''}`}
              aria-pressed={selected}
              aria-label={`${dayLabel(day)}${items.length ? `, ${items.length} workout${items.length === 1 ? '' : 's'}` : ''}`}
              onClick={() => onDayChange(selected ? undefined : day)}
            >
              <span>{Number(day.slice(-2))}</span>
              {items.length > 0 && <i aria-hidden="true">{items.length > 1 ? items.length : ''}</i>}
            </button>
          )
        })}
      </div>
    </section>
  )
}
