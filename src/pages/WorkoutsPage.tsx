import { useMemo, useState } from 'react'
import { Activity, CalendarDays, Dumbbell, ListFilter, Plus, Search, Trophy } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { WorkoutCalendar } from '../components/workouts/WorkoutCalendar'
import { ExerciseDetail, MuscleDistribution, RecentPrs, WeeklyTrainingChart, WorkoutMetricGrid } from '../components/workouts/WorkoutInsights'
import { createWorkout } from '../lib/workouts/mutations'
import { getWorkoutHistory } from '../lib/workouts/selectors'
import { buildWorkoutInsights, type ExerciseProgress, type WorkoutRange } from '../lib/workouts/analytics'
import { elapsedMs, formatDuration, stripStructuralTag, tallyWorkoutSets, workoutLensState, type WorkoutLensState } from '../lib/workouts/presentation'
import type { WorkoutView } from '../lib/workouts/types'
import { formatDay, formatShortDate, isoToday } from '../lib/dates'

type WorkoutsView = 'overview' | 'history' | 'exercises'
const STATE_LABEL: Record<WorkoutLensState, string> = { planned: 'Planned', active: 'Active', completed: 'Completed', canceled: 'Canceled' }
const VIEW_OPTIONS: Array<{ id: WorkoutsView; label: string; icon: typeof Activity }> = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'history', label: 'History', icon: CalendarDays },
  { id: 'exercises', label: 'Exercises', icon: Trophy },
]

function isView(value: string | null): value is WorkoutsView { return value === 'overview' || value === 'history' || value === 'exercises' }
function isRange(value: string | null): value is WorkoutRange { return value === '4w' || value === '12w' || value === 'all' }
function isMonth(value: string | null): value is string { return Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) }
function isDay(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T12:00:00`)
  return !Number.isNaN(parsed.getTime()) && parsed.getFullYear() === Number(value.slice(0, 4)) && parsed.getMonth() + 1 === Number(value.slice(5, 7)) && parsed.getDate() === Number(value.slice(8, 10))
}
function isState(value: string | null): value is WorkoutLensState { return value === 'planned' || value === 'active' || value === 'completed' || value === 'canceled' }

function workoutLabel(workout: WorkoutView): string {
  return workout.thread?.title || stripStructuralTag(workout.task.text, 'workout') || 'Workout'
}

function WorkoutRow({ workout, detailed = false }: { workout: WorkoutView; detailed?: boolean }) {
  const state = workoutLensState(workout)
  const tally = tallyWorkoutSets(workout)
  const duration = elapsedMs(workout)
  const href = `/workout/${workout.task.day}/${workout.task.id}/overview`
  return (
    <div className={`today-workout-row${detailed ? ' workout-history-row' : ''}`}>
      <span className={`today-workout-state state-${state}`}>{STATE_LABEL[state]}</span>
      <div className="workout-row-main">
        <Link className="today-workout-name" to={href}>{workoutLabel(workout)}</Link>
        {detailed && <span className="workout-row-details">{workout.exercises.length} exercises · {tally.completed}/{tally.total} sets{duration !== undefined ? ` · ${formatDuration(duration)}` : ''}</span>}
      </div>
      <time className="today-workout-meta" dateTime={workout.task.day}>{formatDay(workout.task.day).short}</time>
      <Link className="today-workout-open" to={href}>{state === 'active' ? 'Resume' : 'Open'}</Link>
    </div>
  )
}

function NextWorkout({ workouts }: { workouts: readonly WorkoutView[] }) {
  const today = isoToday()
  const active = workouts.find((workout) => workoutLensState(workout) === 'active')
  const upcoming = [...workouts].filter((workout) => workoutLensState(workout) === 'planned' && workout.task.day >= today).sort((a, b) => a.task.day.localeCompare(b.task.day))[0]
  const workout = active ?? upcoming
  if (!workout) return <section className="workout-next workout-next-empty"><div><span>Next session</span><h2>Your training slate is clear.</h2><p>Create a workout when you are ready to train.</p></div></section>
  const state = workoutLensState(workout)
  const tally = tallyWorkoutSets(workout)
  return (
    <section className={`workout-next state-${state}`}>
      <div><span>{state === 'active' ? 'In progress' : 'Next session'}</span><h2>{workoutLabel(workout)}</h2><p>{formatShortDate(workout.task.day)} · {workout.exercises.length} exercises · {tally.total} sets</p></div>
      <Link className="primary-button" to={`/workout/${workout.task.day}/${workout.task.id}/overview`}>{state === 'active' ? 'Resume workout' : 'View workout'}</Link>
    </section>
  )
}

function RangeControl({ range, onChange }: { range: WorkoutRange; onChange: (range: WorkoutRange) => void }) {
  return <div className="workout-range-control" aria-label="Insight range">{([['4w', '4 weeks'], ['12w', '12 weeks'], ['all', 'All time']] as const).map(([id, label]) => <button type="button" key={id} className={range === id ? 'active' : ''} aria-pressed={range === id} onClick={() => onChange(id)}>{label}</button>)}</div>
}

function ExerciseIndexRow({ exercise, selected, onSelect }: { exercise: ExerciseProgress; selected: boolean; onSelect: () => void }) {
  const best = exercise.bestEstimated1rm ?? exercise.bestLoad
  return (
    <button type="button" className={`exercise-index-row${selected ? ' selected' : ''}`} aria-pressed={selected} onClick={onSelect}>
      <span className="exercise-index-monogram" aria-hidden="true">{exercise.title.slice(0, 1).toUpperCase()}</span>
      <span className="exercise-index-copy"><strong>{exercise.title}</strong><small>{exercise.sessions} sessions · {exercise.completedSets} sets · Last {formatDay(exercise.latestDay).short}</small></span>
      <span className="exercise-index-best">{best !== undefined ? <><b>{Math.round(best)}</b><small>{exercise.displayUnit}{exercise.bestEstimated1rm !== undefined ? ' est.' : ' best'}</small></> : <small>No load data</small>}</span>
    </button>
  )
}

export function WorkoutsPage() {
  const workouts = useLiveQuery(() => getWorkoutHistory(), [])
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [busy, setBusy] = useState(false)
  const today = isoToday()
  const rawView = params.get('view')
  const rawRange = params.get('range')
  const rawMonth = params.get('month')
  const rawDay = params.get('day')
  const view: WorkoutsView = isView(rawView) ? rawView : 'overview'
  const range: WorkoutRange = isRange(rawRange) ? rawRange : '4w'
  const month = isMonth(rawMonth) ? rawMonth : today.slice(0, 7)
  const selectedDay = isDay(rawDay) ? rawDay : undefined
  const query = params.get('q') ?? ''
  const rawStatus = params.get('status')
  const status: WorkoutLensState | 'all' = isState(rawStatus) ? rawStatus : 'all'
  const selectedExerciseId = params.get('exercise') ?? undefined

  const setParam = (key: string, value?: string, replace = false) => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (!value) next.delete(key)
      else next.set(key, value)
      return next
    }, { replace })
  }
  const newWorkout = async () => {
    setBusy(true)
    try {
      const id = await createWorkout({ day: today })
      navigate(`/workout/${today}/${id}/overview`)
    } finally { setBusy(false) }
  }

  const insights = useMemo(() => buildWorkoutInsights(workouts ?? [], range, today), [workouts, range, today])
  const history = useMemo(() => (workouts ?? []).filter((workout) => {
    const matchesQuery = workoutLabel(workout).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    const matchesStatus = status === 'all' || workoutLensState(workout) === status
    return matchesQuery && matchesStatus && (!selectedDay || workout.task.day === selectedDay)
  }), [workouts, query, status, selectedDay])
  const exerciseResults = useMemo(() => insights.exercises.filter((exercise) => exercise.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [insights.exercises, query])
  const selectedExercise = insights.exercises.find((exercise) => exercise.id === selectedExerciseId)
  if (workouts === undefined) return <div className="page-loading">Loading training history…</div>

  return (
    <article className="workouts-page">
      <header className="workouts-hero">
        <div><h1>Workouts</h1><p>Train, review, and see what is moving.</p></div>
        <button type="button" className="primary-button workouts-new" disabled={busy} onClick={() => void newWorkout()}><Plus size={16} aria-hidden="true" /> New workout</button>
      </header>
      <nav className="workouts-tabs" aria-label="Workout views" role="tablist">{VIEW_OPTIONS.map(({ id, label, icon: Icon }) => <button type="button" role="tab" id={`workouts-tab-${id}`} aria-controls="workouts-view-panel" aria-selected={view === id} key={id} className={view === id ? 'active' : ''} onClick={() => setParam('view', id === 'overview' ? undefined : id)}><Icon size={16} aria-hidden="true" />{label}</button>)}</nav>

      <div role="tabpanel" id="workouts-view-panel" aria-labelledby={`workouts-tab-${view}`}>
      {workouts.length === 0 ? (
        <div className="workouts-empty"><Dumbbell size={24} aria-hidden="true" /><h2>Build your training history</h2><p>Create your first workout. Completed sessions will turn into trends, records, and exercise progress here.</p><button type="button" className="primary-button" disabled={busy} onClick={() => void newWorkout()}><Plus size={16} /> New workout</button></div>
      ) : view === 'overview' ? (
        <div className="workout-overview-dashboard">
          <NextWorkout workouts={workouts} />
          <div className="workout-dashboard-heading"><div><h2>Your training</h2><p>Completed work in the selected period</p></div><RangeControl range={range} onChange={(next) => setParam('range', next === '4w' ? undefined : next)} /></div>
          <WorkoutMetricGrid insights={insights} />
          <div className="workout-insight-grid"><WeeklyTrainingChart insights={insights} /><RecentPrs insights={insights} /></div>
          <div className="workout-insight-grid workout-insight-grid-secondary">
            <MuscleDistribution insights={insights} />
            <section className="workout-insight-panel"><header className="workout-panel-head"><div><h2>Recent sessions</h2><p>Your latest workout log</p></div><button type="button" className="text-button" onClick={() => setParam('view', 'history')}>View history</button></header>{workouts.some((workout) => workoutLensState(workout) === 'completed') ? workouts.filter((workout) => workoutLensState(workout) === 'completed').slice(0, 5).map((workout) => <WorkoutRow workout={workout} key={workout.task.id} />) : <p className="workout-panel-empty">Completed workouts will appear here.</p>}</section>
          </div>
        </div>
      ) : view === 'history' ? (
        <div className="workout-history-view">
          <WorkoutCalendar month={month} selectedDay={selectedDay} workouts={workouts} onMonthChange={(next) => setParam('month', next === today.slice(0, 7) ? undefined : next)} onDayChange={(day) => setParam('day', day)} />
          <section className="workout-log">
            <header className="workout-log-head"><div><h2>Workout log</h2><p>{history.length} of {workouts.length} sessions</p></div>{(query || status !== 'all' || selectedDay) && <button type="button" className="text-button" onClick={() => setParams({ view: 'history', ...(month !== today.slice(0, 7) ? { month } : {}) })}>Clear filters</button>}</header>
            <div className="workout-log-filters">
              <label className="workout-search"><Search size={15} aria-hidden="true" /><span className="sr-only">Search workout titles</span><input value={query} placeholder="Search workouts" onChange={(event) => setParam('q', event.target.value || undefined, true)} /></label>
              <label className="workout-status-filter"><ListFilter size={15} aria-hidden="true" /><span className="sr-only">Filter by status</span><select value={status} onChange={(event) => setParam('status', event.target.value === 'all' ? undefined : event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="planned">Planned</option><option value="completed">Completed</option><option value="canceled">Canceled</option></select></label>
            </div>
            {selectedDay && <p className="workout-filter-note">Showing {formatShortDate(selectedDay)} <button type="button" onClick={() => setParam('day')}>Show all dates</button></p>}
            {history.length ? <div className="workout-history-list">{history.map((workout) => <WorkoutRow key={workout.task.id} workout={workout} detailed />)}</div> : <div className="workout-log-empty"><Search size={20} /><h3>No workouts match</h3><p>Change the date, search, or status filter.</p></div>}
          </section>
        </div>
      ) : (
        <div className={`workout-exercises-view${selectedExercise ? ' has-selection' : ''}`}>
          <aside className="exercise-index">
            <header><div><h2>Exercises</h2><p>{exerciseResults.length} with completed sets</p></div></header>
            <label className="workout-search"><Search size={15} aria-hidden="true" /><span className="sr-only">Search exercises</span><input value={query} placeholder="Search exercises" onChange={(event) => setParam('q', event.target.value || undefined, true)} /></label>
            <div className="exercise-index-list">{exerciseResults.map((exercise) => <ExerciseIndexRow key={exercise.id} exercise={exercise} selected={exercise.id === selectedExerciseId} onSelect={() => setParam('exercise', exercise.id)} />)}{!exerciseResults.length && <p className="workout-panel-empty">No completed, linked exercises match this search.</p>}</div>
          </aside>
          <main className="exercise-detail-shell">{selectedExercise ? <><button type="button" className="exercise-detail-back" onClick={() => setParam('exercise')}>All exercises</button><ExerciseDetail key={selectedExercise.id} exercise={selectedExercise} /></> : <div className="exercise-detail-empty"><Trophy size={24} /><h2>Choose an exercise</h2><p>Inspect load, reps, volume, estimated strength, and recent sets.</p></div>}</main>
        </div>
      )}
      </div>
    </article>
  )
}
