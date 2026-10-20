import { Fragment } from 'react'
import { scaleCooklangQuantities, splitCooklangSegments } from '../../lib/recipes/cooklangLinks'
import { useRecipeScale } from '../../lib/recipes/recipeScale'

// Read-only rendering of Cooklang-annotated text (a recipe step, an
// ingredient row) as highlighted chips -- the same visual treatment the
// editor gives `@ingredient{}`/`^cookware{}`/`~{}` tokens while typing, so a
// saved recipe reads the same way it was authored.
export function CooklangText({ text }: { text: string }) {
  const scale = useRecipeScale()
  const segments = splitCooklangSegments(scaleCooklangQuantities(text, scale))
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') return <Fragment key={index}>{segment.text}</Fragment>
        return (
          <span key={index} className={`cooklang-chip cooklang-chip-${segment.kind}`}>
            {segment.kind === 'timer' ? '⏱ ' : ''}{segment.text}
          </span>
        )
      })}
    </>
  )
}
