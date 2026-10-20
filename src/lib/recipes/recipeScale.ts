import { createContext, useContext } from 'react'

// How much a recipe is currently scaled relative to its written servings.
// Display-only: Cooklang text rendered under a provider shows scaled
// ingredient quantities, while the stored text (and the editor) stays as
// written.
export const RecipeScaleContext = createContext(1)

export function useRecipeScale(): number {
  return useContext(RecipeScaleContext)
}
