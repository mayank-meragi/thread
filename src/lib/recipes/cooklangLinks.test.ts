import { describe, expect, it } from 'vitest'
import { cooklangLinksToEditor, editorLinksToCooklang, scaleCooklangQuantities } from './cooklangLinks'

describe('cooklangLinksToEditor', () => {
  it('converts a braced ingredient into a labeled chip link', () => {
    expect(cooklangLinksToEditor('Add @flour{200%g} and mix.')).toBe(
      'Add [200 g flour](#cooklang/ingredient/%40flour%7B200%25g%7D "thread-cook-ingredient") and mix.',
    )
  })

  it('converts a bare ingredient with no quantity', () => {
    expect(cooklangLinksToEditor('Season with @salt to taste.')).toBe(
      'Season with [salt](#cooklang/ingredient/%40salt "thread-cook-ingredient") to taste.',
    )
  })

  it('shows ingredient preparation in the chip while preserving the token', () => {
    const result = cooklangLinksToEditor('Add @mushrooms{5}(sliced).')
    expect(result).toBe('Add [5 mushrooms (sliced)](#cooklang/ingredient/%40mushrooms%7B5%7D%28sliced%29 "thread-cook-ingredient").')
    expect(editorLinksToCooklang(result)).toBe('Add @mushrooms{5}(sliced).')
  })

  it('converts a braced timer into a labeled chip link', () => {
    expect(cooklangLinksToEditor('Cook for ~{5%minutes}.')).toBe(
      'Cook for [5 minutes](#cooklang/timer/~%7B5%25minutes%7D "thread-cook-timer").',
    )
  })

  it('converts caret cookware without colliding with structural #[tags]', () => {
    const result = cooklangLinksToEditor('Heat a ^frying pan{} then tag it #[workout].')
    expect(result).toContain('[frying pan](#cooklang/cookware/')
    expect(result).toContain('#[workout]')
  })

  it('does not let a later cookware pass corrupt an earlier ingredient/timer link', () => {
    // Regression: separate token passes could re-match "cooklang" inside a
    // href produced by an earlier ingredient or timer pass.
    const result = cooklangLinksToEditor('Whisk @eggs{2} and cook for ~{2%minutes}.')
    expect(result).toBe(
      'Whisk [2 eggs](#cooklang/ingredient/%40eggs%7B2%7D "thread-cook-ingredient") and cook for [2 minutes](#cooklang/timer/~%7B2%25minutes%7D "thread-cook-timer").',
    )
  })

  it('round-trips back to the exact original text', () => {
    const original = 'Whisk @eggs{2} and @milk{300%ml}, cook in a ^frying pan{} for ~{2%minutes}, season with @salt.'
    expect(editorLinksToCooklang(cooklangLinksToEditor(original))).toBe(original)
  })

  it('leaves plain text with no tokens untouched', () => {
    expect(cooklangLinksToEditor('Preheat the oven.')).toBe('Preheat the oven.')
  })
})

describe('editorLinksToCooklang', () => {
  it('leaves ordinary links untouched', () => {
    const markdown = 'See [the docs](https://example.com) for more.'
    expect(editorLinksToCooklang(markdown)).toBe(markdown)
  })
})

describe('scaleCooklangQuantities', () => {
  it('scales ingredient quantities and keeps preparation, units and wording', () => {
    expect(scaleCooklangQuantities('Add @onion{1}(sliced) and @flour{200%g} to a ^bowl{}.', 2))
      .toBe('Add @onion{2}(sliced) and @flour{400%g} to a ^bowl{}.')
  })

  it('handles fractions and ranges, and leaves non-numeric amounts alone', () => {
    expect(scaleCooklangQuantities('@milk{1/2%cup} @water{3 to 3.5%cups} @salt{as required} @garlic{2}', 2))
      .toBe('@milk{1%cup} @water{6 to 7%cups} @salt{as required} @garlic{4}')
  })

  it('never scales timers, and ignores quantity-less ingredients', () => {
    expect(scaleCooklangQuantities('Simmer @water{2%cups} for ~{20%minutes} with @salt and @pepper{}', 3))
      .toBe('Simmer @water{6%cups} for ~{20%minutes} with @salt and @pepper{}')
  })

  it('is a no-op at factor 1', () => {
    const text = 'Add @flour{200%g}.'
    expect(scaleCooklangQuantities(text, 1)).toBe(text)
  })
})
