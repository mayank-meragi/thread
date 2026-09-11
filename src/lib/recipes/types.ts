import type { PropertyValue, TaskRecord } from '../../db'
import type { RecipeIngredient } from './cooklangTokens'

export interface RecipeStepView {
  index: number
  text: string
  ingredients: RecipeIngredient[]
  cookware: string[]
  durationSeconds?: number
}

export interface RecipeView {
  thread: { id: string; title: string }
  properties: Map<string, PropertyValue>
  steps: RecipeStepView[]
  /** Deduplicated union of every step's ingredients, in first-seen order. */
  ingredients: RecipeIngredient[]
}

export interface CookIngredientView {
  task: TaskRecord
  quantity?: number
  unit?: string
}

export interface CookStepView {
  task: TaskRecord
  durationSeconds?: number
}

/** A daily `#[cook]` task tree instantiated from a recipe thread -- the checkable session you cook from. */
export interface CookSessionView {
  task: TaskRecord
  recipeThreadId?: string
  recipeTitle?: string
  properties: Map<string, PropertyValue>
  ingredients: CookIngredientView[]
  steps: CookStepView[]
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

/** A `#[meal-plan]` placeholder task -- a recipe planned onto a day, with no sub-steps of its own. */
export interface MealPlanView {
  task: TaskRecord
  day: string
  mealType?: MealType
  recipeThreadId?: string
  recipeTitle?: string
}
