import type { PropertyValue } from '../../db'
import { shiftDay } from '../dates'
import { elapsedMs, stripStructuralTag } from './presentation'
import type { WorkoutExerciseView, WorkoutSetView, WorkoutView } from './types'

export type WorkoutRange = '4w' | '12w' | 'all'
export type StrengthMetric = 'load' | 'reps' | 'volume' | 'estimated1rm'

export interface DateRangeWindow {
  start?: string
  end: string
  previousStart?: string
  previousEnd?: string
}

export interface WorkoutPeriodSummary {
  completedWorkouts: number
  previousCompletedWorkouts?: number
  workoutDelta?: number
  trainingTimeMs: number
  timedWorkouts: number
  volumeKg: number
  displayUnit: 'kg' | 'lb'
  streakWeeks: number
}

export interface WeeklyWorkoutPoint {
  week: string
  label: string
  workouts: number
  durationMinutes: number
  volumeKg: number
}

export interface WorkoutPrEvent {
  id: string
  day: string
  exerciseId: string
  exerciseTitle: string
  metric: StrengthMetric
  value: number
  unit?: 'kg' | 'lb'
}

export interface MuscleDistributionItem {
  muscle: string
  sets: number
  percent: number
  classified: boolean
}

export interface ExerciseProgressPoint {
  day: string
  label: string
  maxLoad?: number
  maxReps?: number
  volume?: number
  estimated1rm?: number
}

export interface ExerciseRecentSet {
  id: string
  workoutId: string
  day: string
  load?: number
  reps?: number
  volume?: number
  estimated1rm?: number
  rpe?: number
}

export interface ExerciseProgress {
  id: string
  title: string
  sessions: number
  completedSets: number
  latestDay: string
  displayUnit: 'kg' | 'lb'
  bestLoad?: number
  bestReps?: number
  bestVolume?: number
  bestEstimated1rm?: number
  points: ExerciseProgressPoint[]
  recentSets: ExerciseRecentSet[]
}

export interface WorkoutInsights {
  window: DateRangeWindow
  summary: WorkoutPeriodSummary
  weekly: WeeklyWorkoutPoint[]
  prs: WorkoutPrEvent[]
  muscles: MuscleDistributionItem[]
  exercises: ExerciseProgress[]
}

interface CompletedSetRecord {
  id: string
  workoutId: string
  day: string
  order: number
  exerciseId: string
  exerciseTitle: string
  exercise: WorkoutExerciseView
  properties: Map<string, PropertyValue>
  loadKg?: number
  sourceUnit?: 'kg' | 'lb'
  reps?: number
  volumeKg?: number
  estimated1rmKg?: number
  rpe?: number
}

const LB_TO_KG = 0.45359237

function numberProperty(properties: Map<string, PropertyValue>, id: string): number | undefined {
  const value = properties.get(id)
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function loadUnit(properties: Map<string, PropertyValue>): 'kg' | 'lb' | undefined {
  const value = properties.get('set-load-unit')
  return value === 'kg' || value === 'lb' ? value : undefined
}

export function toKilograms(value: number, unit: 'kg' | 'lb'): number {
  return unit === 'lb' ? value * LB_TO_KG : value
}

export function fromKilograms(value: number, unit: 'kg' | 'lb'): number {
  return unit === 'lb' ? value / LB_TO_KG : value
}

export function estimatedOneRepMax(load: number, reps: number): number | undefined {
  if (!Number.isFinite(load) || load < 0 || !Number.isInteger(reps) || reps < 1 || reps > 12) return undefined
  return load * (1 + reps / 30)
}

function exerciseTitle(exercise: WorkoutExerciseView): string {
  return exercise.exerciseThread?.title || stripStructuralTag(exercise.task.text, 'exercise') || 'Exercise'
}

function exerciseId(exercise: WorkoutExerciseView): string {
  return exercise.exerciseThread?.id || `unlinked:${exercise.task.id}`
}

function setRecord(workout: WorkoutView, exercise: WorkoutExerciseView, set: WorkoutSetView): CompletedSetRecord | undefined {
  if (workout.task.status !== 'done' || set.task.status !== 'done') return undefined
  const rawLoad = numberProperty(set.properties, 'set-load')
  const unit = loadUnit(set.properties)
  const rawReps = numberProperty(set.properties, 'set-reps')
  const reps = rawReps !== undefined && Number.isInteger(rawReps) && rawReps >= 0 ? rawReps : undefined
  const loadKg = rawLoad !== undefined && rawLoad >= 0 && unit ? toKilograms(rawLoad, unit) : undefined
  const volumeKg = loadKg !== undefined && reps !== undefined ? loadKg * reps : undefined
  const oneRepMax = loadKg !== undefined && reps !== undefined ? estimatedOneRepMax(loadKg, reps) : undefined
  const rpe = numberProperty(set.properties, 'set-rpe')
  return {
    id: set.task.id,
    workoutId: workout.task.id,
    day: workout.task.day,
    order: set.task.order,
    exerciseId: exerciseId(exercise),
    exerciseTitle: exerciseTitle(exercise),
    exercise,
    properties: set.properties,
    loadKg,
    sourceUnit: unit,
    reps,
    volumeKg,
    estimated1rmKg: oneRepMax,
    rpe: rpe !== undefined && rpe >= 1 && rpe <= 10 ? rpe : undefined,
  }
}

function completedSetRecords(workouts: readonly WorkoutView[]): CompletedSetRecord[] {
  const records = workouts.flatMap((workout) => workout.exercises.flatMap((exercise) =>
    exercise.sets.map((set) => setRecord(workout, exercise, set)).filter((item): item is CompletedSetRecord => Boolean(item)),
  ))
  return records.sort((a, b) => a.day.localeCompare(b.day) || a.order - b.order || a.id.localeCompare(b.id))
}

function mondayOf(date: string): string {
  const value = new Date(`${date}T12:00:00`)
  const offset = (value.getDay() + 6) % 7
  return shiftDay(date, -offset)
}

function shortDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00`))
}

export function workoutRangeWindow(range: WorkoutRange, today: string, workouts: readonly WorkoutView[] = []): DateRangeWindow {
  if (range === 'all') {
    const earliest = workouts.reduce<string | undefined>((value, workout) => !value || workout.task.day < value ? workout.task.day : value, undefined)
    return { start: earliest, end: today }
  }
  const days = range === '4w' ? 28 : 84
  const start = shiftDay(today, -(days - 1))
  const previousEnd = shiftDay(start, -1)
  return { start, end: today, previousStart: shiftDay(previousEnd, -(days - 1)), previousEnd }
}

function inWindow(day: string, start: string | undefined, end: string): boolean {
  return (!start || day >= start) && day <= end
}

function latestUnit(records: readonly CompletedSetRecord[]): 'kg' | 'lb' {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const unit = records[index].sourceUnit
    if (unit) return unit
  }
  return 'kg'
}

export function consecutiveTrainingWeeks(workouts: readonly WorkoutView[], today: string): number {
  const weeks = new Set(workouts.filter((workout) => workout.task.status === 'done').map((workout) => mondayOf(workout.task.day)))
  let cursor = mondayOf(today)
  if (!weeks.has(cursor)) cursor = shiftDay(cursor, -7)
  let count = 0
  while (weeks.has(cursor)) {
    count += 1
    cursor = shiftDay(cursor, -7)
  }
  return count
}

function weeklySeries(workouts: readonly WorkoutView[], records: readonly CompletedSetRecord[], window: DateRangeWindow): WeeklyWorkoutPoint[] {
  const firstDay = window.start ?? workouts.reduce<string | undefined>((value, workout) => !value || workout.task.day < value ? workout.task.day : value, undefined)
  if (!firstDay) return []
  const firstWeek = mondayOf(firstDay)
  const lastWeek = mondayOf(window.end)
  const byWeek = new Map<string, WeeklyWorkoutPoint>()
  for (let cursor = firstWeek; cursor <= lastWeek; cursor = shiftDay(cursor, 7)) {
    byWeek.set(cursor, { week: cursor, label: shortDate(cursor), workouts: 0, durationMinutes: 0, volumeKg: 0 })
  }
  for (const workout of workouts) {
    if (workout.task.status !== 'done' || !inWindow(workout.task.day, window.start, window.end)) continue
    const point = byWeek.get(mondayOf(workout.task.day))
    if (!point) continue
    point.workouts += 1
    const duration = elapsedMs(workout)
    if (duration !== undefined) point.durationMinutes += Math.round(duration / 60_000)
  }
  for (const record of records) {
    if (!inWindow(record.day, window.start, window.end) || record.volumeKg === undefined) continue
    const point = byWeek.get(mondayOf(record.day))
    if (point) point.volumeKg += record.volumeKg
  }
  return [...byWeek.values()]
}

function prEvents(records: readonly CompletedSetRecord[]): WorkoutPrEvent[] {
  const best = new Map<string, Partial<Record<StrengthMetric, number>>>()
  const events: WorkoutPrEvent[] = []
  for (const record of records) {
    const exerciseBest = best.get(record.exerciseId) ?? {}
    const values: Array<[StrengthMetric, number | undefined]> = [
      ['load', record.loadKg], ['reps', record.reps], ['volume', record.volumeKg], ['estimated1rm', record.estimated1rmKg],
    ]
    for (const [metric, value] of values) {
      if (value === undefined) continue
      const previous = exerciseBest[metric]
      if (previous !== undefined && value > previous) {
        events.push({
          id: `${record.id}:${metric}`,
          day: record.day,
          exerciseId: record.exerciseId,
          exerciseTitle: record.exerciseTitle,
          metric,
          value: metric === 'reps' ? value : fromKilograms(value, record.sourceUnit ?? 'kg'),
          unit: metric === 'reps' ? undefined : record.sourceUnit ?? 'kg',
        })
      }
      if (previous === undefined || value > previous) exerciseBest[metric] = value
    }
    best.set(record.exerciseId, exerciseBest)
  }
  return events.sort((a, b) => b.day.localeCompare(a.day) || b.id.localeCompare(a.id))
}

function muscleDistribution(records: readonly CompletedSetRecord[]): MuscleDistributionItem[] {
  const values = new Map<string, number>()
  let classified = 0
  let unclassified = 0
  for (const record of records) {
    const muscles = record.exercise.guide?.primaryMuscles ?? []
    if (muscles.length === 0) {
      unclassified += 1
      continue
    }
    classified += 1
    const allocation = 1 / muscles.length
    for (const muscle of muscles) values.set(muscle, (values.get(muscle) ?? 0) + allocation)
  }
  if (classified === 0) return []
  const total = classified + unclassified
  const result = [...values.entries()].map(([muscle, sets]) => ({ muscle, sets, percent: total ? sets / total * 100 : 0, classified: true }))
  if (unclassified > 0) result.push({ muscle: 'unclassified', sets: unclassified, percent: unclassified / total * 100, classified: false })
  return result.sort((a, b) => b.sets - a.sets || a.muscle.localeCompare(b.muscle))
}

function exerciseProgress(records: readonly CompletedSetRecord[]): ExerciseProgress[] {
  const grouped = new Map<string, CompletedSetRecord[]>()
  for (const record of records) {
    if (record.exerciseId.startsWith('unlinked:')) continue
    grouped.set(record.exerciseId, [...(grouped.get(record.exerciseId) ?? []), record])
  }
  return [...grouped.entries()].map(([id, items]) => {
    const unit = latestUnit(items)
    const sessions = new Set(items.map((item) => item.workoutId)).size
    const byDay = new Map<string, ExerciseProgressPoint>()
    for (const item of items) {
      const point = byDay.get(item.day) ?? { day: item.day, label: shortDate(item.day) }
      if (item.loadKg !== undefined) point.maxLoad = Math.max(point.maxLoad ?? -Infinity, fromKilograms(item.loadKg, unit))
      if (item.reps !== undefined) point.maxReps = Math.max(point.maxReps ?? -Infinity, item.reps)
      if (item.volumeKg !== undefined) point.volume = (point.volume ?? 0) + fromKilograms(item.volumeKg, unit)
      if (item.estimated1rmKg !== undefined) point.estimated1rm = Math.max(point.estimated1rm ?? -Infinity, fromKilograms(item.estimated1rmKg, unit))
      byDay.set(item.day, point)
    }
    const convertedLoads = items.flatMap((item) => item.loadKg === undefined ? [] : [fromKilograms(item.loadKg, unit)])
    const convertedVolumes = items.flatMap((item) => item.volumeKg === undefined ? [] : [fromKilograms(item.volumeKg, unit)])
    const convertedEstimates = items.flatMap((item) => item.estimated1rmKg === undefined ? [] : [fromKilograms(item.estimated1rmKg, unit)])
    return {
      id,
      title: items[items.length - 1].exerciseTitle,
      sessions,
      completedSets: items.length,
      latestDay: items[items.length - 1].day,
      displayUnit: unit,
      bestLoad: convertedLoads.length ? Math.max(...convertedLoads) : undefined,
      bestReps: Math.max(...items.flatMap((item) => item.reps === undefined ? [] : [item.reps]), -Infinity) === -Infinity ? undefined : Math.max(...items.flatMap((item) => item.reps === undefined ? [] : [item.reps])),
      bestVolume: convertedVolumes.length ? Math.max(...convertedVolumes) : undefined,
      bestEstimated1rm: convertedEstimates.length ? Math.max(...convertedEstimates) : undefined,
      points: [...byDay.values()],
      recentSets: items.slice(-12).reverse().map((item) => ({
        id: item.id,
        workoutId: item.workoutId,
        day: item.day,
        load: item.loadKg === undefined ? undefined : fromKilograms(item.loadKg, unit),
        reps: item.reps,
        volume: item.volumeKg === undefined ? undefined : fromKilograms(item.volumeKg, unit),
        estimated1rm: item.estimated1rmKg === undefined ? undefined : fromKilograms(item.estimated1rmKg, unit),
        rpe: item.rpe,
      })),
    }
  }).sort((a, b) => b.latestDay.localeCompare(a.latestDay) || a.title.localeCompare(b.title))
}

export function buildWorkoutInsights(workouts: readonly WorkoutView[], range: WorkoutRange, today: string): WorkoutInsights {
  const window = workoutRangeWindow(range, today, workouts)
  const completed = workouts.filter((workout) => workout.task.status === 'done' && inWindow(workout.task.day, window.start, window.end))
  const allRecords = completedSetRecords(workouts).filter((record) => record.day <= today)
  const records = allRecords.filter((record) => inWindow(record.day, window.start, window.end))
  const previousStart = window.previousStart
  const previousEnd = window.previousEnd
  const previousCompleted = previousStart && previousEnd
    ? workouts.filter((workout) => workout.task.status === 'done' && inWindow(workout.task.day, previousStart, previousEnd)).length
    : undefined
  const durations = completed.map((workout) => elapsedMs(workout)).filter((value): value is number => value !== undefined)
  const unit = latestUnit(records)
  const volumeKg = records.reduce((sum, record) => sum + (record.volumeKg ?? 0), 0)
  return {
    window,
    summary: {
      completedWorkouts: completed.length,
      previousCompletedWorkouts: previousCompleted,
      workoutDelta: previousCompleted === undefined ? undefined : completed.length - previousCompleted,
      trainingTimeMs: durations.reduce((sum, duration) => sum + duration, 0),
      timedWorkouts: durations.length,
      volumeKg,
      displayUnit: unit,
      streakWeeks: consecutiveTrainingWeeks(workouts, today),
    },
    weekly: weeklySeries(workouts, allRecords, window),
    prs: prEvents(allRecords).filter((event) => inWindow(event.day, window.start, window.end)),
    muscles: muscleDistribution(records),
    exercises: exerciseProgress(allRecords),
  }
}
