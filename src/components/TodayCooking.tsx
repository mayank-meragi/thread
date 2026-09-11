import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { ChefHat } from 'lucide-react'
import { getActiveCookSession, getMealPlanForDay } from '../lib/recipes/selectors'
import type { MealType } from '../lib/recipes/types'

const MEAL_LABEL: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }

interface TodayCookingProps {
  today: string
}

// Quiet by design: renders nothing unless there's an active cook session or a
// meal planned for today, so a user who has never touched recipes never sees
// an empty prompt cluttering their journal -- same restraint TodayTasks shows
// by only rendering sections that have content.
export function TodayCooking({ today }: TodayCookingProps) {
  // useLiveQuery returns `undefined` both while loading and whenever the
  // querier itself resolves to `undefined` (no active session) -- normalize
  // "no active session" to `null` so it can't be mistaken for "still loading".
  const activeCook = useLiveQuery(async () => (await getActiveCookSession(today)) ?? null, [today])
  const plans = useLiveQuery(() => getMealPlanForDay(today), [today], [])

  if (activeCook === undefined) return null
  if (!activeCook && plans.length === 0) return null

  const doneSteps = activeCook?.steps.filter((step) => step.task.status === 'done').length ?? 0

  return (
    <section className="today-cooking">
      {activeCook && (
        <Link to={`/cook/${activeCook.task.day}/${activeCook.task.id}`} className="today-cooking-active">
          <ChefHat size={15} aria-hidden="true" />
          <span>Resume cooking <strong>{activeCook.recipeTitle ?? 'a recipe'}</strong></span>
          <span className="today-cooking-progress">{doneSteps}/{activeCook.steps.length} steps</span>
        </Link>
      )}
      {plans.length > 0 && (
        <ul className="today-cooking-plans">
          {plans.map((plan) => (
            <li key={plan.task.id}>
              <span className="today-cooking-meal-type">{MEAL_LABEL[plan.mealType ?? 'snack']}</span>
              {plan.recipeThreadId ? <Link to={`/recipe/${plan.recipeThreadId}`}>{plan.recipeTitle}</Link> : <span>{plan.recipeTitle ?? 'Recipe'}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
