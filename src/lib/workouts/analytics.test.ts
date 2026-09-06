import { describe, expect, it } from 'vitest'
import type { PropertyValue, TaskRecord } from '../../db'
import type { WorkoutSetView, WorkoutView } from './types'
import {
  buildWorkoutInsights,
  consecutiveTrainingWeeks,
  estimatedOneRepMax,
  fromKilograms,
  toKilograms,
  workoutRangeWindow,
} from './analytics'

function task(id: string, day: string, status: TaskRecord['status'], order = 0): TaskRecord {
  return {
    id, blockId: id, day, line: order, order, text: '', checked: status === 'done', status,
    statusSource: 'manual', completedSubtasks: 0, totalSubtasks: 0, updatedAt: `${day}T12:00:00.000Z`,
  }
}

function set(id: string, day: string, values: Record<string, PropertyValue>, status: TaskRecord['status'] = 'done'): WorkoutSetView {
  return { task: task(id, day, status), properties: new Map(Object.entries(values)), propertyRows: [], tags: [] }
}

function workout(
  id: string,
  day: string,
  sets: WorkoutSetView[],
  options: { status?: TaskRecord['status']; title?: string; muscles?: string[]; startedAt?: string; finishedAt?: string } = {},
): WorkoutView {
  return {
    task: task(id, day, options.status ?? 'done'),
    properties: new Map([
      ...(options.startedAt ? [['workout-started-at', options.startedAt] as const] : []),
      ...(options.finishedAt ? [['workout-finished-at', options.finishedAt] as const] : []),
    ]),
    exercises: [{
      task: task(`e-${id}`, day, 'done'),
      exerciseThread: { id: 'bench-press', title: options.title ?? 'Bench Press' },
      guide: options.muscles ? { primaryMuscles: options.muscles, secondaryMuscles: [], equipment: [], imageUrls: [] } : undefined,
      sets,
      notes: [],
    }],
    notes: [], diagnostics: [],
  }
}

describe('workout analytics primitives', () => {
  it('creates equal current and previous rolling windows', () => {
    expect(workoutRangeWindow('4w', '2026-09-06')).toEqual({
      start: '2026-08-10', end: '2026-09-06', previousStart: '2026-07-13', previousEnd: '2026-08-09',
    })
    expect(workoutRangeWindow('12w', '2026-09-06').start).toBe('2026-06-15')
  })

  it('converts load units and limits Epley estimates to 1–12 reps', () => {
    expect(toKilograms(100, 'lb')).toBeCloseTo(45.359, 3)
    expect(fromKilograms(toKilograms(100, 'lb'), 'lb')).toBeCloseTo(100)
    expect(estimatedOneRepMax(100, 10)).toBeCloseTo(133.333)
    expect(estimatedOneRepMax(100, 13)).toBeUndefined()
    expect(estimatedOneRepMax(100, 0)).toBeUndefined()
  })

  it('counts consecutive local calendar weeks and allows the current week to be empty', () => {
    const workouts = [
      workout('a', '2026-08-24', []),
      workout('b', '2026-08-31', []),
      workout('c', '2026-08-17', [], { status: 'canceled' }),
    ]
    expect(consecutiveTrainingWeeks(workouts, '2026-09-06')).toBe(2)
    expect(consecutiveTrainingWeeks(workouts, '2026-09-08')).toBe(2)
  })
})

describe('buildWorkoutInsights', () => {
  it('uses completed work only and reports duration coverage, mixed units, and muscles', () => {
    const workouts = [
      workout('new', '2026-09-01', [set('s-new', '2026-09-01', { 'set-load': 100, 'set-load-unit': 'lb', 'set-reps': 10 })], {
        muscles: ['chest', 'triceps'], startedAt: '2026-09-01T10:00:00.000Z', finishedAt: '2026-09-01T11:00:00.000Z',
      }),
      workout('old', '2026-08-20', [set('s-old', '2026-08-20', { 'set-load': 40, 'set-load-unit': 'kg', 'set-reps': 10 })], { muscles: ['chest'] }),
      workout('planned', '2026-09-02', [set('s-planned', '2026-09-02', { 'set-load': 200, 'set-load-unit': 'kg', 'set-reps': 10 })], { status: 'not_started' }),
    ]
    const insights = buildWorkoutInsights(workouts, '4w', '2026-09-06')
    expect(insights.summary.completedWorkouts).toBe(2)
    expect(insights.summary.timedWorkouts).toBe(1)
    expect(insights.summary.trainingTimeMs).toBe(60 * 60_000)
    expect(insights.summary.displayUnit).toBe('lb')
    expect(insights.summary.volumeKg).toBeCloseTo(40 * 10 + 100 * 0.45359237 * 10)
    expect(insights.muscles.find((item) => item.muscle === 'chest')?.sets).toBe(1.5)
  })

  it('uses first performances as baselines, ignores ties, and emits strict PR improvements', () => {
    const workouts = [
      workout('third', '2026-09-03', [set('s3', '2026-09-03', { 'set-load': 110, 'set-load-unit': 'kg', 'set-reps': 5 })]),
      workout('tie', '2026-09-02', [set('s2', '2026-09-02', { 'set-load': 100, 'set-load-unit': 'kg', 'set-reps': 5 })]),
      workout('base', '2026-09-01', [set('s1', '2026-09-01', { 'set-load': 100, 'set-load-unit': 'kg', 'set-reps': 5 })]),
    ]
    const insights = buildWorkoutInsights(workouts, 'all', '2026-09-06')
    expect(insights.prs.map((event) => event.metric).sort()).toEqual(['estimated1rm', 'load', 'volume'])
    expect(insights.prs.every((event) => event.day === '2026-09-03')).toBe(true)
  })

  it('omits muscle distribution when no completed exercise has guide metadata', () => {
    const insights = buildWorkoutInsights([
      workout('a', '2026-09-01', [set('s', '2026-09-01', { 'set-reps': 10 })]),
    ], 'all', '2026-09-06')
    expect(insights.muscles).toEqual([])
  })
})
