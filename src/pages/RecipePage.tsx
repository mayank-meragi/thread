import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChefHat, Minus, Plus, Trash2 } from 'lucide-react'
import { formatQuantity, scaleIngredient } from '../lib/recipes/cooklangTokens'
import { isoToday } from '../lib/dates'
import { ActiveCookConflictError, startCook } from '../lib/recipes/lifecycle'
import { addStep, removeStep, updateStep } from '../lib/recipes/mutations'
import { getRecipe } from '../lib/recipes/selectors'
import type { RecipeIngredient } from '../lib/recipes/cooklangTokens'

function IngredientRow({ ingredient }: { ingredient: RecipeIngredient }) {
  return (
    <li className="recipe-ingredient-row">
      {ingredient.quantity !== undefined && <span className="recipe-ingredient-quantity">{formatQuantity(ingredient.quantity)}{ingredient.unit ? ` ${ingredient.unit}` : ''}</span>}
      <span className="recipe-ingredient-name">{ingredient.name}</span>
    </li>
  )
}

function StepEditor({ step, onSave, onRemove }: { step: { index: number; text: string }; onSave: (text: string) => Promise<void>; onRemove: () => void }) {
  const [text, setText] = useState(step.text)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const commit = async () => {
    if (!text.trim() || text === step.text) { setEditing(false); return }
    setSaving(true)
    try {
      await onSave(text)
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  return (
    <li className="recipe-step-row">
      <span className="recipe-step-number">{step.index + 1}</span>
      {editing ? (
        <textarea
          className="recipe-step-input"
          value={text}
          autoFocus
          onChange={(event) => setText(event.target.value)}
          onBlur={() => void commit()}
          disabled={saving}
        />
      ) : (
        <p className="recipe-step-text" onClick={() => setEditing(true)}>{step.text}</p>
      )}
      <button type="button" className="recipe-step-remove" aria-label="Remove step" onClick={onRemove}><Trash2 size={14} aria-hidden="true" /></button>
    </li>
  )
}

export function RecipePage() {
  const { threadId = '' } = useParams()
  const navigate = useNavigate()
  const recipe = useLiveQuery(async () => (threadId ? (await getRecipe(threadId)) ?? null : null), [threadId])
  const [newStep, setNewStep] = useState('')
  const [addingStep, setAddingStep] = useState(false)
  const [servingsOverride, setServingsOverride] = useState<number | null>(null)
  const [cookError, setCookError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  if (recipe === undefined) return <div className="page-loading">Loading recipe…</div>
  if (recipe === null) {
    return (
      <div className="recipe-page">
        <Link to="/recipes" className="back-link">Back to recipes</Link>
        <p className="section-empty">This recipe no longer exists.</p>
      </div>
    )
  }

  const baseServings = typeof recipe.properties.get('recipe-servings') === 'number' ? (recipe.properties.get('recipe-servings') as number) : 4
  const servings = servingsOverride ?? baseServings
  const scaleFactor = baseServings > 0 ? servings / baseServings : 1
  const prepMinutes = recipe.properties.get('recipe-prep-minutes')
  const cookMinutes = recipe.properties.get('recipe-cook-minutes')

  const submitNewStep = async () => {
    if (!newStep.trim()) return
    setAddingStep(true)
    try {
      await addStep(threadId, newStep)
      setNewStep('')
    } finally {
      setAddingStep(false)
    }
  }

  // Scaling servings only changes what is displayed here -- it never rewrites
  // the recipe's own `recipe-servings` property (that is also the number the
  // scale factor is computed against, so persisting it here would silently
  // redefine the recipe's base every time someone views it at a different size).
  const changeServings = (next: number) => {
    if (next < 1) return
    setServingsOverride(next)
  }

  const startCooking = async () => {
    setStarting(true)
    setCookError(null)
    try {
      const today = isoToday()
      const cookTaskId = await startCook(threadId, { day: today, servings })
      navigate(`/cook/${today}/${cookTaskId}`)
    } catch (caught) {
      if (caught instanceof ActiveCookConflictError) {
        setCookError('Another cook session is already in progress. Finish or cancel it first.')
      } else {
        setCookError(caught instanceof Error ? caught.message : String(caught))
      }
    } finally {
      setStarting(false)
    }
  }

  return (
    <article className="recipe-page">
      <Link to="/recipes" className="back-link">Back to recipes</Link>
      <header className="recipe-page-hero">
        <div>
          <h1>{recipe.thread.title}</h1>
          <p className="recipe-page-meta">
            {typeof prepMinutes === 'number' ? `${prepMinutes} min prep` : null}
            {typeof prepMinutes === 'number' && typeof cookMinutes === 'number' ? ' · ' : null}
            {typeof cookMinutes === 'number' ? `${cookMinutes} min cook` : null}
          </p>
        </div>
        <button type="button" className="primary-button" disabled={starting || !recipe.steps.length} onClick={() => void startCooking()}>
          <ChefHat size={16} aria-hidden="true" /> Start cooking
        </button>
      </header>
      {cookError && <p className="add-exercise-error" role="alert">{cookError}</p>}

      <section className="recipe-ingredients-panel">
        <header className="recipe-panel-head">
          <h2>Ingredients</h2>
          <div className="recipe-servings-scaler" aria-label="Servings">
            <button type="button" onClick={() => changeServings(servings - 1)} aria-label="Fewer servings"><Minus size={14} aria-hidden="true" /></button>
            <span>{servings} serving{servings === 1 ? '' : 's'}</span>
            <button type="button" onClick={() => changeServings(servings + 1)} aria-label="More servings"><Plus size={14} aria-hidden="true" /></button>
          </div>
        </header>
        {recipe.ingredients.length ? (
          <ul className="recipe-ingredient-list">
            {recipe.ingredients.map((ingredient) => <IngredientRow key={ingredient.name} ingredient={scaleIngredient(ingredient, scaleFactor)} />)}
          </ul>
        ) : (
          <p className="section-empty">Add steps with <code>@ingredient{'{'}qty%unit{'}'}</code> tokens and they will show up here automatically.</p>
        )}
      </section>

      <section className="recipe-steps-panel">
        <h2>Steps</h2>
        {recipe.steps.length ? (
          <ol className="recipe-step-list">
            {recipe.steps.map((step) => (
              <StepEditor
                key={step.index}
                step={step}
                onSave={(text) => updateStep(threadId, step.index, text)}
                onRemove={() => void removeStep(threadId, step.index)}
              />
            ))}
          </ol>
        ) : (
          <p className="section-empty">No steps yet — add the first one below.</p>
        )}
        <form
          className="add-exercise-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submitNewStep()
          }}
        >
          <input
            value={newStep}
            onChange={(event) => setNewStep(event.target.value)}
            placeholder="Whisk @eggs{2} and @milk{300%ml} together."
            aria-label="New step"
          />
          <button type="submit" className="primary-button" disabled={addingStep || !newStep.trim()}><Plus size={14} aria-hidden="true" /> Add step</button>
        </form>
      </section>
    </article>
  )
}
