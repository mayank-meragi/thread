import type { BlockTagRecord } from '../../db'
import { workoutRoleFromTagIds, type WorkoutRole } from './systemTags'

/**
 * Resolve the structural workout role for every block that has one, from a flat
 * list of block-tag rows. Shared by the surfaces that need to treat workout
 * roots specially and hide exercise/set internals (Tasks, Today, AI context).
 */
export function workoutRolesByBlockId(tagRows: readonly BlockTagRecord[]): Map<string, WorkoutRole> {
  const tagIdsByBlock = new Map<string, string[]>()
  for (const row of tagRows) {
    tagIdsByBlock.set(row.blockId, [...(tagIdsByBlock.get(row.blockId) ?? []), row.tagId])
  }
  const roles = new Map<string, WorkoutRole>()
  for (const [blockId, tagIds] of tagIdsByBlock) {
    const role = workoutRoleFromTagIds(tagIds)
    if (role) roles.set(blockId, role)
  }
  return roles
}

/** Exercise and set tasks are "internals" — hidden from general task views and counts by default. */
export function isWorkoutInternalRole(role: WorkoutRole | undefined): boolean {
  return role === 'exercise' || role === 'set'
}
