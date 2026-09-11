import { describe, expect, it } from 'vitest'
import { normalizeRecipeMarkdown, parseRecipeDocument } from './recipeDocument'

describe('recipeDocument', () => {
  it('uses tagged blocks and indentation to build the recipe outline', () => {
    const document = parseRecipeDocument([
      '- #[cook-section] Make the broth',
      '  - #[cook-step] Add @water{2%cups} to ^pot{}.',
      '  - #[cook-note] Keep it partially covered.',
      '  - #[cook-section] Finish',
      '    - #[cook-step] Add @salt{}.',
      '- #[cook-step] Serve.',
    ].join('\n'))

    expect(document.roots.map((node) => node.role)).toEqual(['cook-section', 'cook-step'])
    expect(document.roots[0].children.map((node) => node.role)).toEqual(['cook-step', 'cook-note', 'cook-section'])
    expect(document.roots[0].children[0].parentId).toBe(document.roots[0].id)
    expect(document.roots[0].children[2].children[0].role).toBe('cook-step')
  })

  it('keeps legacy outlines readable and normalizes inferred roles', () => {
    const markdown = '- Make the broth\n  - Add @water{2%cups}.\n- Serve.'
    const document = parseRecipeDocument(markdown)
    expect(document.roots[0].role).toBe('cook-section')
    expect(document.roots[0].children[0].role).toBe('cook-step')
    expect(document.roots[1].role).toBe('cook-step')
    expect(normalizeRecipeMarkdown(markdown)).toBe('- #[cook-section] Make the broth\n  - #[cook-step] Add @water{2%cups}.\n- #[cook-step] Serve.')
  })
})
