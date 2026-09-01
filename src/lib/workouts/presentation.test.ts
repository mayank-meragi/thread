import { describe, expect, it } from 'vitest'
import type { TaskRecord } from '../../db'
import type { PropertyValue } from '../dayDocument'
import type { WorkoutSetView, WorkoutView } from './types'
import {
  describeSet,
  elapsedMs,
  exerciseSummary,
  formatDuration,
  nextActionableSetId,
  sourceHref,
  stripStructuralTag,
  tallyWorkoutSets,
  workoutLensState,
} from './presentation'

function task(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: 'task', blockId: 'task', day: '2026-09-01', line: 0, order: 0, text: '', checked: false,
    status: 'not_started', statusSource: 'derived', completedSubtasks: 0, totalSubtasks: 0,
    updatedAt: '2026-09-01T00:00:00.000Z', ...overrides,
  }
}

function setView(id: string, status: TaskRecord['status']): WorkoutSetView {
  return { task: task({ id, status }), properties: new Map(), propertyRows: [], tags: [] }
}

function workout(props: Record<string, PropertyValue>, sets: WorkoutSetView[]): WorkoutView {
  return {
    task: task({ id: 'w', status: 'in_progress' }),
    properties: new Map(Object.entries(props)),
    exercises: [{ task: task({ id: 'e', status: 'in_progress' }), sets, notes: [] }],
    notes: [],
    diagnostics: [],
  }
}

describe('workout presentation helpers', () => {
  it('maps task status to a lens state', () => {
    expect(workoutLensState({ task: task({ status: 'not_started' }) })).toBe('planned')
    expect(workoutLensState({ task: task({ status: 'in_progress' }) })).toBe('active')
    expect(workoutLensState({ task: task({ status: 'done' }) })).toBe('completed')
    expect(workoutLensState({ task: task({ status: 'canceled' }) })).toBe('canceled')
  })

  it('tallies completed / actionable / skipped sets', () => {
    const view = workout({}, [setView('a', 'done'), setView('b', 'canceled'), setView('c', 'not_started')])
    expect(tallyWorkoutSets(view)).toEqual({ completed: 1, skipped: 1, actionable: 1, total: 3 })
  })

  it('computes elapsed time from start to finish, or to now while active', () => {
    const started = '2026-09-01T10:00:00.000Z'
    const finished = '2026-09-01T11:04:00.000Z'
    expect(elapsedMs({ properties: new Map([['workout-started-at', started]]) }, Date.parse('2026-09-01T10:30:00.000Z'))).toBe(30 * 60_000)
    expect(elapsedMs({ properties: new Map([['workout-started-at', started], ['workout-finished-at', finished]]) })).toBe(64 * 60_000)
    expect(elapsedMs({ properties: new Map() })).toBeUndefined()
  })

  it('formats durations compactly', () => {
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(64 * 60_000)).toBe('1h 04m')
    expect(formatDuration(9 * 60_000 + 5_000)).toBe('9m 05s')
  })

  it('finds the next actionable set in document order', () => {
    const view = workout({}, [setView('a', 'done'), setView('b', 'canceled'), setView('c', 'not_started'), setView('d', 'not_started')])
    expect(nextActionableSetId(view)).toBe('c')
    expect(nextActionableSetId(workout({}, [setView('a', 'done')]))).toBeUndefined()
  })

  it('summarizes an exercise as complete when no sets remain actionable', () => {
    expect(exerciseSummary({ task: task({ status: 'in_progress' }), sets: [setView('a', 'done'), setView('b', 'canceled')] }).complete).toBe(true)
    expect(exerciseSummary({ task: task({ status: 'in_progress' }), sets: [setView('a', 'not_started')] }).complete).toBe(false)
    expect(exerciseSummary({ task: task({ status: 'in_progress' }), sets: [] }).complete).toBe(false)
  })

  it('builds a hash-router source link for a block', () => {
    expect(sourceHref(task({ id: 'blk', day: '2026-09-01' }))).toBe('#/?date=2026-09-01&block=blk')
  })

  it('strips the structural hashtag and wiki-link syntax from a task label', () => {
    expect(stripStructuralTag('#workout [[Push Day]]', 'workout')).toBe('Push Day')
    expect(stripStructuralTag('#[workout] Push Day', 'workout')).toBe('Push Day')
    expect(stripStructuralTag('#exercise [[Bench Press]]', 'exercise')).toBe('Bench Press')
    expect(stripStructuralTag('#set Set 3', 'set')).toBe('Set 3')
    expect(stripStructuralTag('#set', 'set')).toBe('')
  })

  it('describes the measurements a set carries', () => {
    expect(describeSet(new Map<string, PropertyValue>([['set-load', 60], ['set-load-unit', 'kg'], ['set-reps', 8], ['set-rpe', 7]]))).toBe('60 kg × 8 · RPE 7')
    expect(describeSet(new Map<string, PropertyValue>([['set-reps', 12]]))).toBe('12 reps')
    expect(describeSet(new Map<string, PropertyValue>([['set-distance', 400], ['set-distance-unit', 'm'], ['set-duration-seconds', 90]]))).toBe('400 m · 1m 30s')
    expect(describeSet(new Map())).toBe('')
  })
})
