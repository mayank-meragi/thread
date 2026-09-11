import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, ShoppingCart, X } from 'lucide-react'
import { daysBetween, formatDay, isoToday, shiftDay } from '../lib/dates'
import { planMeal, removeMealPlan } from '../lib/recipes/mutations'
import { getMealPlanRange, listRecipes } from '../lib/recipes/selectors'
import type { MealPlanView, MealType } from '../lib/recipes/types'

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack']
const MEAL_LABEL: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }

function AddMealForm({ day, recipes }: { day: string; recipes: Array<{ id: string; title: string }> }) {
  const [open, setOpen] = useState(false)
  const [recipeId, setRecipeId] = useState(recipes[0]?.id ?? '')
  const [mealType, setMealType] = useState<MealType>('dinner')
  const [busy, setBusy] = useState(false)

  if (!recipes.length) return null
  if (!open) return <button type="button" className="meal-plan-add" onClick={() => setOpen(true)}><Plus size={13} aria-hidden="true" /> Add meal</button>

  const submit = async () => {
    if (!recipeId) return
    setBusy(true)
    try {
      await planMeal(recipeId, day, mealType)
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="meal-plan-add-form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <select value={recipeId} onChange={(event) => setRecipeId(event.target.value)} disabled={busy}>
        {recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.title}</option>)}
      </select>
      <select value={mealType} onChange={(event) => setMealType(event.target.value as MealType)} disabled={busy}>
        {MEAL_TYPES.map((type) => <option key={type} value={type}>{MEAL_LABEL[type]}</option>)}
      </select>
      <button type="submit" className="text-button" disabled={busy}>Add</button>
      <button type="button" className="text-button" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
    </form>
  )
}

function DayColumn({ day, plans, recipes }: { day: string; plans: MealPlanView[]; recipes: Array<{ id: string; title: string }> }) {
  const label = formatDay(day)
  const isToday = day === isoToday()
  return (
    <div className={`meal-plan-day${isToday ? ' is-today' : ''}`}>
      <header>
        <span>{label.weekday}</span>
        <strong>{label.short}</strong>
      </header>
      <ul>
        {plans.map((plan) => (
          <li key={plan.task.id} className={`meal-plan-item meal-${plan.mealType ?? 'snack'}`}>
            <span className="meal-plan-type-label">{MEAL_LABEL[plan.mealType ?? 'snack']}</span>
            {plan.recipeThreadId ? <Link to={`/recipe/${plan.recipeThreadId}`}>{plan.recipeTitle}</Link> : <span>{plan.recipeTitle ?? 'Recipe'}</span>}
            <button type="button" aria-label="Remove planned meal" onClick={() => void removeMealPlan(plan.task.id)}><X size={12} aria-hidden="true" /></button>
          </li>
        ))}
      </ul>
      <AddMealForm day={day} recipes={recipes} />
    </div>
  )
}

export function MealPlanPage() {
  const [params, setParams] = useSearchParams()
  const today = isoToday()
  const startDay = params.get('start') ?? today
  const endDay = shiftDay(startDay, 6)
  const days = useMemo(() => daysBetween(startDay, endDay), [startDay, endDay])

  const recipes = useLiveQuery(() => listRecipes(), [])
  const plans = useLiveQuery(() => getMealPlanRange(startDay, endDay), [startDay, endDay])

  const plansByDay = useMemo(() => {
    const grouped = new Map<string, MealPlanView[]>()
    for (const plan of plans ?? []) grouped.set(plan.day, [...(grouped.get(plan.day) ?? []), plan])
    return grouped
  }, [plans])

  const shiftWeek = (amount: number) => setParams((current) => {
    const next = new URLSearchParams(current)
    const shifted = shiftDay(startDay, amount * 7)
    if (shifted === today) next.delete('start')
    else next.set('start', shifted)
    return next
  })

  if (recipes === undefined || plans === undefined) return <div className="page-loading">Loading meal plan…</div>

  const recipeOptions = recipes.map((recipe) => ({ id: recipe.thread.id, title: recipe.thread.title }))

  return (
    <article className="meal-plan-page">
      <header className="meal-plan-hero">
        <div><h1>Meal plan</h1><p>{formatDay(startDay).short} – {formatDay(endDay).short}</p></div>
        <div className="meal-plan-hero-actions">
          <nav className="meal-plan-nav" aria-label="Week">
            <button type="button" onClick={() => shiftWeek(-1)} aria-label="Previous week"><ChevronLeft size={16} aria-hidden="true" /></button>
            <button type="button" onClick={() => shiftWeek(1)} aria-label="Next week"><ChevronRight size={16} aria-hidden="true" /></button>
          </nav>
          <Link className="secondary-button" to={`/shopping-list?start=${startDay}&end=${endDay}`}><ShoppingCart size={15} aria-hidden="true" /> Shopping list</Link>
        </div>
      </header>

      {recipeOptions.length === 0 ? (
        <p className="section-empty">Add a recipe first, then plan it onto a day here.</p>
      ) : (
        <div className="meal-plan-grid">
          {days.map((day) => <DayColumn key={day} day={day} plans={plansByDay.get(day) ?? []} recipes={recipeOptions} />)}
        </div>
      )}
    </article>
  )
}
