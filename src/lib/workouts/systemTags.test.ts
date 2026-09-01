import { describe, expect, it } from 'vitest'
import {
  isWorkoutSystemTag,
  systemTagIdForWorkoutRole,
  workoutRoleFromTagIds,
  WORKOUT_SYSTEM_TAGS,
} from './systemTags'

describe('workout system tags', () => {
  it('maps roles and stable tag ids in both directions', () => {
    expect(systemTagIdForWorkoutRole('workout')).toBe('system-workout')
    expect(systemTagIdForWorkoutRole('exercise')).toBe('system-exercise')
    expect(systemTagIdForWorkoutRole('set')).toBe('system-set')
    expect(workoutRoleFromTagIds(['project', WORKOUT_SYSTEM_TAGS.set])).toBe('set')
  })

  it('does not treat ordinary tags as workout system tags', () => {
    expect(isWorkoutSystemTag(WORKOUT_SYSTEM_TAGS.workout)).toBe(true)
    expect(isWorkoutSystemTag('workout')).toBe(false)
    expect(workoutRoleFromTagIds(['workout', 'strength'])).toBeUndefined()
  })
})
