import { describe, expect, it } from 'vitest'
import {
  cookRoleFromTagIds,
  isRecipeSystemTag,
  RECIPE_SYSTEM_TAGS,
  systemTagIdForCookRole,
} from './systemTags'

describe('recipe system tags', () => {
  it('maps roles and stable tag ids in both directions', () => {
    expect(systemTagIdForCookRole('cook')).toBe('system-cook')
    expect(systemTagIdForCookRole('cookIngredient')).toBe('system-cook-ingredient')
    expect(systemTagIdForCookRole('cookStep')).toBe('system-cook-step')
    expect(systemTagIdForCookRole('mealPlan')).toBe('system-meal-plan')
    expect(cookRoleFromTagIds(['project', RECIPE_SYSTEM_TAGS.cookStep])).toBe('cookStep')
    expect(cookRoleFromTagIds(['project', RECIPE_SYSTEM_TAGS.mealPlan])).toBe('mealPlan')
  })

  it('does not treat ordinary tags as recipe system tags', () => {
    expect(isRecipeSystemTag(RECIPE_SYSTEM_TAGS.cook)).toBe(true)
    expect(isRecipeSystemTag('cook')).toBe(false)
    expect(cookRoleFromTagIds(['cook', 'dinner'])).toBeUndefined()
  })
})
