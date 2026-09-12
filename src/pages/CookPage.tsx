import { Fragment, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, SkipForward } from 'lucide-react'
import { CookTimer } from '../components/recipes/CookTimer'
import { CooklangText } from '../components/recipes/CooklangText'
import {
  UnresolvedCookStepsError,
  completeCookStep,
  finishCook,
  skipCookStep,
  toggleCookIngredient,
} from '../lib/recipes/lifecycle'
import { getCookSession } from '../lib/recipes/selectors'
import type { CookStepView } from '../lib/recipes/types'
import { Button } from 'fiber'

// A task's stored text keeps the structural tag (`#[cook-step] foo`); accept
// the legacy unbracketed form too because older task records may contain it.
function stripStructuralPrefix(text: string, role: 'cook-ingredient' | 'cook-step'): string {
  return text.replace(new RegExp(`^#\\[?${role}\\]?\\s*`), '').trim()
}

function stepState(step: CookStepView): 'done' | 'skipped' | 'pending' {
  if (step.task.status === 'done') return 'done'
  if (step.task.status === 'canceled') return 'skipped'
  return 'pending'
}

export function CookPage() {
  const { day = '', blockId = '' } = useParams()
  const navigate = useNavigate()
  const session = useLiveQuery(async () => (blockId ? (await getCookSession(blockId)) ?? null : null), [blockId])
  const [activeStepId, setActiveStepId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (session === undefined) return <div className="page-loading">Loading cook session…</div>
  if (session === null) {
    return (
      <div className="cook-page">
        <Link to={day ? `/?date=${day}` : '/'} className="back-link">Back</Link>
        <p className="section-empty">This block is not a cook session, or it no longer exists.</p>
      </div>
    )
  }

  const firstPending = session.steps.find((step) => stepState(step) === 'pending')
  const activeId = activeStepId ?? firstPending?.task.id ?? session.steps[0]?.task.id
  const recipeHref = session.recipeThreadId ? `/recipe/${session.recipeThreadId}` : undefined
  const servings = session.properties.get('cook-servings')
  const finished = session.task.status === 'done'

  const guard = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const markDone = (stepId: string) => guard(async () => {
    const next = await completeCookStep(stepId)
    setActiveStepId(next ?? null)
  })

  const skip = (stepId: string) => guard(async () => {
    await skipCookStep(stepId)
    const stepIndex = session.steps.findIndex((step) => step.task.id === stepId)
    setActiveStepId(session.steps.slice(stepIndex + 1).find((step) => stepState(step) === 'pending')?.task.id ?? null)
  })

  const finish = () => guard(async () => {
    try {
      await finishCook(session.task.id)
    } catch (caught) {
      if (!(caught instanceof UnresolvedCookStepsError)) throw caught
      const cancel = window.confirm(
        `${caught.stepTaskIds.length} step${caught.stepTaskIds.length === 1 ? '' : 's'} still unresolved. Mark them skipped? (Cancel keeps them pending.)`,
      )
      await finishCook(session.task.id, { unresolvedSteps: cancel ? 'cancel' : 'leave' })
    }
  })

  return (
    <article className="cook-page">
      <Link to={recipeHref ?? '/recipes'} className="back-link"><ArrowLeft size={15} aria-hidden="true" /> {session.recipeTitle ?? 'Recipe'}</Link>

      <header className="cook-page-hero">
        <h1>{session.recipeTitle ?? 'Cooking'}</h1>
        <p className="cook-page-meta">
          {typeof servings === 'number' ? `${servings} servings` : null}
          {finished ? ' · Finished' : ' · In progress'}
        </p>
      </header>

      {error && <p className="add-exercise-error" role="alert">{error}</p>}

      <section className="cook-ingredients-panel">
        <h2>Ingredients</h2>
        {session.ingredients.length ? (
          <ul className="cook-ingredient-checklist">
            {session.ingredients.map((ingredient) => (
              <li key={ingredient.task.id} className={ingredient.task.status === 'done' ? 'gathered' : ''}>
                <label>
                  <input
                    type="checkbox"
                    checked={ingredient.task.status === 'done'}
                    onChange={(event) => void toggleCookIngredient(ingredient.task.id, event.target.checked)}
                  />
                  {ingredient.quantity !== undefined ? <span className="cook-ingredient-quantity">{ingredient.quantity}{ingredient.unit ? ` ${ingredient.unit}` : ''}</span> : null}
                  <span>{stripStructuralPrefix(ingredient.task.text, 'cook-ingredient')}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : <p className="section-empty">No ingredients on this recipe.</p>}
      </section>

      <section className="cook-steps-panel">
        <h2>Steps</h2>
        <ol className="cook-step-list">
          {session.steps.map((step, index) => {
            const state = stepState(step)
            const isActive = step.task.id === activeId
            const text = stripStructuralPrefix(step.task.text, 'cook-step')
            const previousSection = session.steps[index - 1]?.sectionTitle
            return (
              <Fragment key={step.task.id}>
                {step.sectionTitle && step.sectionTitle !== previousSection && <li className="cook-section-title">{step.sectionTitle}</li>}
                <li className={`cook-step-row state-${state}${isActive ? ' active' : ''}`}>
                  <span className="cook-step-number">{state === 'done' ? <Check size={13} aria-hidden="true" /> : index + 1}</span>
                  <div className="cook-step-body">
                    <p><CooklangText text={text} /></p>
                    {isActive && state === 'pending' && (
                      <div className="cook-step-actions">
                        {step.durationSeconds !== undefined && <CookTimer key={step.task.id} seconds={step.durationSeconds} />}
                        <Button disabled={busy} onClick={() => void markDone(step.task.id)}>
                          <Check size={14} aria-hidden="true" /> Done
                        </Button>
                        <Button variant="ghost" disabled={busy} onClick={() => void skip(step.task.id)}>
                          <SkipForward size={14} aria-hidden="true" /> Skip
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              </Fragment>
            )
          })}
        </ol>
      </section>

      {!finished && (
        <Button className="cook-finish" disabled={busy} onClick={() => void finish()}>
          Finish cooking
        </Button>
      )}
      {finished && (
        <Button variant="ghost" onClick={() => navigate(recipeHref ?? '/recipes')}>
          Back to recipe
        </Button>
      )}
    </article>
  )
}
