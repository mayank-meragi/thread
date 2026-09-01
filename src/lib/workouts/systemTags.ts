export const WORKOUT_SYSTEM_TAGS = {
  workout: 'system-workout',
  exercise: 'system-exercise',
  set: 'system-set',
} as const

export type WorkoutRole = keyof typeof WORKOUT_SYSTEM_TAGS
export type WorkoutSystemTagId = (typeof WORKOUT_SYSTEM_TAGS)[WorkoutRole]

const roleByTagId = new Map<WorkoutSystemTagId, WorkoutRole>(
  Object.entries(WORKOUT_SYSTEM_TAGS).map(([role, tagId]) => [tagId, role as WorkoutRole]),
)

export function systemTagIdForWorkoutRole(role: WorkoutRole): WorkoutSystemTagId {
  return WORKOUT_SYSTEM_TAGS[role]
}

export function workoutRoleFromTagIds(tagIds: readonly string[]): WorkoutRole | undefined {
  for (const tagId of tagIds) {
    const role = roleByTagId.get(tagId as WorkoutSystemTagId)
    if (role) return role
  }
  return undefined
}

export function isWorkoutSystemTag(tagId: string): tagId is WorkoutSystemTagId {
  return roleByTagId.has(tagId as WorkoutSystemTagId)
}

