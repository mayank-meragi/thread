import type { BlockTagRecord } from '../../db'
import { cookRoleFromTagIds, type CookRole } from './systemTags'

/**
 * Resolve the structural cook role for every block that has one, from a flat
 * list of block-tag rows. Shared by surfaces that need to keep cook-session
 * blocks separate from general task views.
 */
export function cookRolesByBlockId(tagRows: readonly BlockTagRecord[]): Map<string, CookRole> {
  const tagIdsByBlock = new Map<string, string[]>()
  for (const row of tagRows) {
    tagIdsByBlock.set(row.blockId, [...(tagIdsByBlock.get(row.blockId) ?? []), row.tagId])
  }
  const roles = new Map<string, CookRole>()
  for (const [blockId, tagIds] of tagIdsByBlock) {
    const role = cookRoleFromTagIds(tagIds)
    if (role) roles.set(blockId, role)
  }
  return roles
}

/** All structurally tagged cook-session blocks are hidden from general task views. */
export function isCookRole(role: CookRole | undefined): boolean {
  return role !== undefined
}
