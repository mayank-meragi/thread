import type { BlockTagRecord } from '../../db'
import { workoutRoleFromTagIds, type WorkoutRole } from './systemTags'

/**
 * Resolve the structural workout role for every block that has one, from a flat
 * list of block-tag rows. Shared by surfaces that need to keep workout blocks
 * separate from general task views.
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

/** All structurally tagged workout blocks are hidden from general task views. */
export function isWorkoutRole(role: WorkoutRole | undefined): boolean {
  return role !== undefined
}
