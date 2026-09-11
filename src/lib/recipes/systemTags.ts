// Structural tags for the daily-task side of the recipe feature: a cook
// session (`#[cook]` with `#[cook-ingredient]`/`#[cook-step]` children) and a
// meal-plan placeholder (`#[meal-plan]`). Mirrors `lib/workouts/systemTags.ts`
// exactly: a recipe *thread* itself carries no structural tag (see
// selectors.ts's RECIPE_MARKER_PROPERTY), but both of these live in a day the
// same way a workout does, so they need the same stable-tag-id registry.
// "CookRole" is a slight misnomer for `mealPlan` (planning a meal isn't
// cooking) -- kept as one union because both share every piece of exclusivity/
// protection/exclusion machinery below and in db.ts/integration.ts.

export const RECIPE_SYSTEM_TAGS = {
  cook: 'system-cook',
  cookIngredient: 'system-cook-ingredient',
  cookStep: 'system-cook-step',
  mealPlan: 'system-meal-plan',
} as const

export type CookRole = keyof typeof RECIPE_SYSTEM_TAGS
export type RecipeSystemTagId = (typeof RECIPE_SYSTEM_TAGS)[CookRole]

const roleByTagId = new Map<RecipeSystemTagId, CookRole>(
  Object.entries(RECIPE_SYSTEM_TAGS).map(([role, tagId]) => [tagId, role as CookRole]),
)

export function systemTagIdForCookRole(role: CookRole): RecipeSystemTagId {
  return RECIPE_SYSTEM_TAGS[role]
}

export function cookRoleFromTagIds(tagIds: readonly string[]): CookRole | undefined {
  for (const tagId of tagIds) {
    const role = roleByTagId.get(tagId as RecipeSystemTagId)
    if (role) return role
  }
  return undefined
}

export function isRecipeSystemTag(tagId: string): tagId is RecipeSystemTagId {
  return roleByTagId.has(tagId as RecipeSystemTagId)
}
