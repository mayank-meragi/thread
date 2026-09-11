import type { PropertyValue, TaskRecord } from '../../db'
import type { RecipeIngredient } from './cooklangTokens'

export interface RecipeStepView {
  id: string
  index: number
  text: string
  sectionId?: string
  sectionTitle?: string
  sourceLine: number
  depth: number
  ingredients: RecipeIngredient[]
  cookware: string[]
  durationSeconds?: number
  notes: RecipeNoteView[]
}

export interface RecipeNoteView {
  id: string
  text: string
  sourceLine: number
  depth: number
  sectionId?: string
  parentStepId?: string
}

export interface RecipeSectionView {
  id: string
  title: string
  depth: number
  parentSectionId?: string
  children: RecipeSectionView[]
  steps: RecipeStepView[]
  notes: RecipeNoteView[]
  ingredients: RecipeIngredient[]
  cookware: string[]
}

export interface RecipeView {
  thread: { id: string; title: string }
  properties: Map<string, PropertyValue>
  sections: RecipeSectionView[]
  unsectionedSteps: RecipeStepView[]
  unsectionedNotes: RecipeNoteView[]
  steps: RecipeStepView[]
  /** Deduplicated union of every step's ingredients, in first-seen order. */
  ingredients: RecipeIngredient[]
  /** Deduplicated union of every step's cookware, in first-seen order. */
  cookware: string[]
}

export interface CookIngredientView {
  task: TaskRecord
  quantity?: number
  unit?: string
}

export interface CookStepView {
  task: TaskRecord
  durationSeconds?: number
  sectionTitle?: string
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
