import { useMemo, useState } from 'react'
import { Activity, Award, Clock3, Flame, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { EXERCISE_MUSCLE_OPTIONS } from '../../lib/blockMetadata'
import { formatDuration } from '../../lib/workouts/presentation'
import { fromKilograms, type ExerciseProgress, type StrengthMetric, type WorkoutInsights as Insights } from '../../lib/workouts/analytics'

const MUSCLE_LABELS = new Map(EXERCISE_MUSCLE_OPTIONS.map((option) => [option.id, option.label]))
const METRIC_LABELS: Record<StrengthMetric, string> = {
  load: 'Load', reps: 'Reps', volume: 'Set volume', estimated1rm: 'Estimated 1RM',
}

function compactNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat('en-US', { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits }).format(value)
}

function MetricCard({ label, value, note, icon }: { label: string; value: string; note: string; icon: React.ReactNode }) {
  return (
    <div className="workout-metric-card">
      <span className="workout-metric-icon" aria-hidden="true">{icon}</span>
      <div>
        <span className="workout-metric-label">{label}</span>
        <strong>{value}</strong>
        <span className="workout-metric-note">{note}</span>
      </div>
    </div>
  )
}

export function WorkoutMetricGrid({ insights }: { insights: Insights }) {
  const { summary } = insights
  const volume = fromKilograms(summary.volumeKg, summary.displayUnit)
  const delta = summary.workoutDelta
  return (
    <div className="workout-metric-grid" aria-label="Training summary">
      <MetricCard
        icon={<Activity size={17} />}
        label="Completed"
        value={String(summary.completedWorkouts)}
        note={delta === undefined ? 'All recorded time' : `${delta > 0 ? '+' : ''}${delta} from prior period`}
      />
      <MetricCard
        icon={<Flame size={17} />}
        label="Weekly streak"
        value={`${summary.streakWeeks} ${summary.streakWeeks === 1 ? 'week' : 'weeks'}`}
        note="At least one completed session"
      />
      {summary.timedWorkouts > 0 && (
        <MetricCard
          icon={<Clock3 size={17} />}
          label="Training time"
          value={formatDuration(summary.trainingTimeMs)}
          note={`${summary.timedWorkouts} of ${summary.completedWorkouts} sessions timed`}
        />
      )}
      {summary.volumeKg > 0 && (
        <MetricCard
          icon={<TrendingUp size={17} />}
          label="Strength volume"
          value={`${compactNumber(volume)} ${summary.displayUnit}`}
          note="Completed load × reps"
        />
      )}
    </div>
  )
}

export function WeeklyTrainingChart({ insights }: { insights: Insights }) {
  const populated = insights.weekly.some((point) => point.workouts > 0)
  return (
    <section className="workout-insight-panel workout-weekly-panel">
      <header className="workout-panel-head">
        <div><h2>Training pulse</h2><p>Completed sessions by week</p></div>
        <strong>{insights.summary.completedWorkouts}</strong>
      </header>
      {populated ? (
        <>
          <div className="workout-chart" role="img" aria-label="Line chart of completed workouts per week">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={insights.weekly} margin={{ top: 10, right: 12, bottom: 0, left: -24 }} accessibilityLayer>
                <CartesianGrid vertical={false} stroke="var(--line-soft)" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} width={32} />
                <Tooltip contentStyle={{ background: 'var(--paper-raised)', border: '1px solid var(--line)', borderRadius: 8 }} />
                <Line type="monotone" dataKey="workouts" name="Workouts" stroke="var(--thread)" strokeWidth={2.5} dot={{ r: 3, fill: 'var(--paper)', strokeWidth: 2 }} activeDot={{ r: 5 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="workout-chart-summary">{insights.weekly.map((point) => `${point.label}: ${point.workouts}`).join('; ')}.</p>
        </>
      ) : <p className="workout-panel-empty">Complete a workout to start the weekly pulse.</p>}
    </section>
  )
}

export function RecentPrs({ insights }: { insights: Insights }) {
  return (
    <section className="workout-insight-panel">
      <header className="workout-panel-head"><div><h2>Recent records</h2><p>Strict improvements after your baseline</p></div><Award size={19} aria-hidden="true" /></header>
      {insights.prs.length ? (
        <div className="workout-pr-list">
          {insights.prs.slice(0, 6).map((pr) => (
            <div className="workout-pr-row" key={pr.id}>
              <span className="workout-pr-mark" aria-hidden="true" />
              <div><strong>{pr.exerciseTitle}</strong><span>{METRIC_LABELS[pr.metric]}</span></div>
              <b>{compactNumber(pr.value, 1)}{pr.unit ? ` ${pr.unit}` : ''}</b>
              <time dateTime={pr.day}>{pr.day}</time>
            </div>
          ))}
        </div>
      ) : <p className="workout-panel-empty">New records appear after an exercise has a baseline and then improves.</p>}
    </section>
  )
}

export function MuscleDistribution({ insights }: { insights: Insights }) {
  if (!insights.muscles.length) {
    return (
      <section className="workout-insight-panel">
        <header className="workout-panel-head"><div><h2>Muscle distribution</h2><p>Based on completed sets</p></div></header>
        <p className="workout-panel-empty">Add primary muscles to exercise guides to see training distribution.</p>
      </section>
    )
  }
  const data = insights.muscles.slice(0, 8).map((item) => ({ ...item, label: item.classified ? (MUSCLE_LABELS.get(item.muscle) ?? item.muscle) : 'Unclassified' }))
  return (
    <section className="workout-insight-panel">
      <header className="workout-panel-head"><div><h2>Muscle distribution</h2><p>Share of completed sets</p></div></header>
      <div className="workout-muscle-chart" role="img" aria-label="Bar chart showing completed sets by primary muscle">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 4 }} accessibilityLayer>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="label" width={88} axisLine={false} tickLine={false} tick={{ fill: 'var(--ink-soft)', fontSize: 12 }} />
            <Tooltip formatter={(value) => [`${compactNumber(Number(value), 1)} sets`, 'Work']} contentStyle={{ background: 'var(--paper-raised)', border: '1px solid var(--line)', borderRadius: 8 }} />
            <Bar dataKey="sets" radius={[0, 5, 5, 0]} isAnimationActive={false}>
              {data.map((item) => <Cell key={item.muscle} fill={item.classified ? 'var(--thread)' : 'var(--outline-muted)'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="workout-chart-summary">{data.map((item) => `${item.label}: ${compactNumber(item.percent, 1)}%`).join('; ')}.</p>
    </section>
  )
}

function progressMetricValue(point: ExerciseProgress['points'][number], metric: StrengthMetric): number | undefined {
  if (metric === 'load') return point.maxLoad
  if (metric === 'reps') return point.maxReps
  if (metric === 'volume') return point.volume
  return point.estimated1rm
}

export function ExerciseDetail({ exercise }: { exercise: ExerciseProgress }) {
  const available = useMemo(() => (['load', 'reps', 'volume', 'estimated1rm'] as StrengthMetric[])
    .filter((metric) => exercise.points.some((point) => progressMetricValue(point, metric) !== undefined)), [exercise])
  const [requestedMetric, setRequestedMetric] = useState<StrengthMetric>('estimated1rm')
  const metric = available.includes(requestedMetric) ? requestedMetric : available[0]
  const data = exercise.points.map((point) => ({ ...point, value: metric ? progressMetricValue(point, metric) : undefined }))
  return (
    <section className="exercise-progress-detail" aria-labelledby="exercise-progress-title">
      <header>
        <div><h2 id="exercise-progress-title">{exercise.title}</h2><p>{exercise.sessions} sessions · {exercise.completedSets} completed sets</p></div>
        <Link to={`/thread/${exercise.id}`}>Open thread</Link>
      </header>
      {metric ? (
        <>
          <div className="exercise-metric-tabs" aria-label="Progress metric">
            {available.map((item) => <button type="button" className={item === metric ? 'active' : ''} aria-pressed={item === metric} key={item} onClick={() => setRequestedMetric(item)}>{METRIC_LABELS[item]}</button>)}
          </div>
          <div className="workout-chart exercise-progress-chart" role="img" aria-label={`${METRIC_LABELS[metric]} progression for ${exercise.title}`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 12, right: 14, bottom: 0, left: -8 }} accessibilityLayer>
                <CartesianGrid vertical={false} stroke="var(--line-soft)" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} width={48} domain={['auto', 'auto']} />
                <Tooltip formatter={(value) => [`${compactNumber(Number(value), 1)}${metric === 'reps' ? '' : ` ${exercise.displayUnit}`}`, METRIC_LABELS[metric]]} contentStyle={{ background: 'var(--paper-raised)', border: '1px solid var(--line)', borderRadius: 8 }} />
                <Line type="monotone" dataKey="value" name={METRIC_LABELS[metric]} connectNulls stroke="var(--thread)" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="workout-chart-summary">{data.filter((point) => point.value !== undefined).map((point) => `${point.label}: ${compactNumber(point.value ?? 0, 1)}`).join('; ')}.</p>
        </>
      ) : <p className="workout-panel-empty">Record load or reps on completed sets to see progression.</p>}
      <div className="exercise-recent-sets">
        <h3>Recent sets</h3>
        {exercise.recentSets.map((set) => (
          <div key={set.id} className="exercise-recent-set-row">
            <time dateTime={set.day}>{set.day}</time>
            <span>{set.load !== undefined ? `${compactNumber(set.load, 1)} ${exercise.displayUnit}` : '—'}</span>
            <span>{set.reps !== undefined ? `${set.reps} reps` : '—'}</span>
            <span>{set.rpe !== undefined ? `RPE ${set.rpe}` : ''}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
