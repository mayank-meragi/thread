import { describe, expect, it } from 'vitest'
import { mergeIngredients, parseCooklangTokens, scaleIngredient } from './cooklangTokens'

describe('parseCooklangTokens', () => {
  it('parses a braced ingredient with quantity and unit', () => {
    const result = parseCooklangTokens('Add @flour{200%g} and mix.')
    expect(result.ingredients).toEqual([{ name: 'flour', quantity: 200, unit: 'g', raw: '@flour{200%g}' }])
  })

  it('parses a multi-word ingredient name', () => {
    const result = parseCooklangTokens('Whisk in @brown sugar{50%g}.')
    expect(result.ingredients[0]).toMatchObject({ name: 'brown sugar', quantity: 50, unit: 'g' })
  })

  it('parses an ingredient with quantity but no unit', () => {
    const result = parseCooklangTokens('Crack @eggs{2} into a bowl.')
    expect(result.ingredients[0]).toMatchObject({ name: 'eggs', quantity: 2, unit: undefined })
  })

  it('parses an ingredient with no quantity at all, braced or bare', () => {
    const braced = parseCooklangTokens('Season with @salt{} to taste.')
    expect(braced.ingredients[0]).toMatchObject({ name: 'salt', quantity: undefined, unit: undefined })
    const bare = parseCooklangTokens('Season with @salt to taste.')
    expect(bare.ingredients[0]).toEqual({ name: 'salt', raw: '@salt' })
  })

  it('parses a fractional quantity', () => {
    const result = parseCooklangTokens('Add @sugar{1/2%cup}.')
    expect(result.ingredients[0]).toMatchObject({ name: 'sugar', quantity: 0.5, unit: 'cup' })
  })

  it('parses multiple ingredients in one step', () => {
    const result = parseCooklangTokens('Whisk @eggs{2} and @milk{300%ml} together.')
    expect(result.ingredients).toHaveLength(2)
    expect(result.ingredients.map((ingredient) => ingredient.name)).toEqual(['eggs', 'milk'])
  })

  it('parses a bare and braced cookware token', () => {
    const result = parseCooklangTokens('Heat a #frying pan{} then use the #whisk.')
    expect(result.cookware).toEqual([
      { name: 'frying pan', raw: '#frying pan{}' },
      { name: 'whisk', raw: '#whisk' },
    ])
  })

  it('parses a timer with no preceding ingredient', () => {
    const result = parseCooklangTokens('Cook for ~{5%minutes}.')
    expect(result.timers).toEqual([{ label: undefined, quantity: 5, unit: 'minutes', seconds: 300, raw: '~{5%minutes}' }])
    expect(result.durationSeconds).toBe(300)
  })

  it('parses a labeled timer', () => {
    const result = parseCooklangTokens('Let it ~rest{10%minutes} before serving.')
    expect(result.timers[0]).toMatchObject({ label: 'rest', quantity: 10, unit: 'minutes', seconds: 600 })
  })

  it('parses hours and seconds units', () => {
    expect(parseCooklangTokens('~{1%hour}').timers[0].seconds).toBe(3600)
    expect(parseCooklangTokens('~{30%seconds}').timers[0].seconds).toBe(30)
  })

  it('ignores an unrecognized timer unit for seconds but keeps quantity/unit', () => {
    const result = parseCooklangTokens('~{2%batches}')
    expect(result.timers[0]).toMatchObject({ quantity: 2, unit: 'batches', seconds: undefined })
  })

  it('returns empty arrays for plain text with no tokens', () => {
    const result = parseCooklangTokens('Preheat the oven.')
    expect(result).toEqual({ ingredients: [], cookware: [], timers: [], durationSeconds: undefined })
  })

  it('does not let a bare match swallow part of a braced token', () => {
    const result = parseCooklangTokens('Add @flour{200%g}.')
    expect(result.ingredients).toHaveLength(1)
  })
})

describe('mergeIngredients', () => {
  it('dedupes by case-insensitive name, summing quantities with matching units', () => {
    const merged = mergeIngredients([
      { name: 'Flour', quantity: 200, unit: 'g', raw: '@Flour{200%g}' },
      { name: 'flour', quantity: 50, unit: 'g', raw: '@flour{50%g}' },
      { name: 'eggs', quantity: 2, raw: '@eggs{2}' },
    ])
    expect(merged).toEqual([
      { name: 'Flour', quantity: 250, unit: 'g', raw: '@Flour{200%g}' },
      { name: 'eggs', quantity: 2, raw: '@eggs{2}' },
    ])
  })

  it('keeps first-seen order', () => {
    const merged = mergeIngredients([
      { name: 'milk', quantity: 100, unit: 'ml', raw: '@milk{100%ml}' },
      { name: 'flour', quantity: 200, unit: 'g', raw: '@flour{200%g}' },
    ])
    expect(merged.map((ingredient) => ingredient.name)).toEqual(['milk', 'flour'])
  })
})

describe('scaleIngredient', () => {
  it('scales quantity by the given factor', () => {
    expect(scaleIngredient({ name: 'flour', quantity: 200, unit: 'g', raw: '' }, 1.5)).toMatchObject({ quantity: 300 })
  })

  it('leaves quantity-less ingredients untouched', () => {
    expect(scaleIngredient({ name: 'salt', raw: '' }, 2)).toEqual({ name: 'salt', raw: '' })
  })
})
