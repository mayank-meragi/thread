import { describe, expect, it } from 'vitest'
import type { BlockTagRecord } from '../../db'
import { WORKOUT_SYSTEM_TAGS } from './systemTags'
import { isWorkoutInternalRole, workoutRolesByBlockId } from './integration'

function tag(blockId: string, tagId: string): BlockTagRecord {
  return { id: `${blockId}:${tagId}`, blockId, day: '2026-09-01', tagId, source: 'inline', updatedAt: '' }
}

describe('workout surface integration helpers', () => {
  it('resolves the structural role for each tagged block, ignoring descriptive tags', () => {
    const roles = workoutRolesByBlockId([
      tag('w', WORKOUT_SYSTEM_TAGS.workout),
      tag('e', WORKOUT_SYSTEM_TAGS.exercise),
      tag('s', WORKOUT_SYSTEM_TAGS.set),
      tag('s', 'warmup'),
      tag('plain', 'idea'),
    ])
    expect(roles.get('w')).toBe('workout')
    expect(roles.get('e')).toBe('exercise')
    expect(roles.get('s')).toBe('set')
    expect(roles.has('plain')).toBe(false)
  })

  it('treats exercise and set as internals but not the workout root', () => {
    expect(isWorkoutInternalRole('workout')).toBe(false)
    expect(isWorkoutInternalRole('exercise')).toBe(true)
    expect(isWorkoutInternalRole('set')).toBe(true)
    expect(isWorkoutInternalRole(undefined)).toBe(false)
  })
})
