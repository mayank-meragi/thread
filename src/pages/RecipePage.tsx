import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChefHat, Minus, Plus, Trash2 } from 'lucide-react'
import { CooklangText } from '../components/recipes/CooklangText'
import { formatQuantity, scaleIngredient } from '../lib/recipes/cooklangTokens'
import { isoToday } from '../lib/dates'
import { ActiveCookConflictError, startCook } from '../lib/recipes/lifecycle'
import { addNote, addSection, addStep, addStepToSection, deleteRecipeThread, removeStep, updateStep } from '../lib/recipes/mutations'
import { getRecipe } from '../lib/recipes/selectors'
import type { RecipeIngredient } from '../lib/recipes/cooklangTokens'
import type { RecipeSectionView, RecipeStepView } from '../lib/recipes/types'
import { Button } from '../components/ui'

type RecipePanel = 'ingredients' | 'cookware' | 'steps'

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.toLocaleLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function IngredientRow({ ingredient }: { ingredient: RecipeIngredient }) {
  return (
    <li className="recipe-ingredient-row">
      <span className="recipe-ingredient-name">{ingredient.name}{ingredient.preparation ? ` (${ingredient.preparation})` : ''}</span>
      {ingredient.quantity !== undefined && <span className="recipe-ingredient-quantity">{formatQuantity(ingredient.quantity)}{ingredient.unit ? ` ${ingredient.unit}` : ''}</span>}
    </li>
  )
}

function IngredientList({ ingredients, scaleFactor }: { ingredients: RecipeIngredient[]; scaleFactor: number }) {
  if (!ingredients.length) return null
  return <ul className="recipe-ingredient-list">{ingredients.map((ingredient) => <IngredientRow key={`${ingredient.name}:${ingredient.preparation ?? ''}`} ingredient={scaleIngredient(ingredient, scaleFactor)} />)}</ul>
}

function StepEditor({ step, displayIndex, onSave, onRemove }: { step: RecipeStepView; displayIndex: number; onSave: (text: string) => Promise<void>; onRemove: () => void }) {
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
      <span className="recipe-step-number">{displayIndex}</span>
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
        <p className="recipe-step-text" onClick={() => setEditing(true)}><CooklangText text={step.text} /></p>
      )}
      <Button variant="danger" size="sm" iconOnly className="recipe-step-remove" aria-label="Remove step" onClick={onRemove}><Trash2 size={14} aria-hidden="true" /></Button>
      {step.notes.length > 0 && <div className="recipe-step-notes">{step.notes.map((note) => <p key={note.id}><span>Note</span><CooklangText text={note.text} /></p>)}</div>}
    </li>
  )
}

function flattenSections(sections: RecipeSectionView[]): RecipeSectionView[] {
  return sections.flatMap((section) => [section, ...flattenSections(section.children)])
}

function flattenNoteTargets(sections: RecipeSectionView[]): Array<{ id: string; label: string }> {
  return sections.flatMap((section) => [
    { id: section.id, label: section.title },
    ...section.steps.map((step, index) => ({ id: step.id, label: `  Step ${index + 1}: ${step.text}` })),
    ...flattenNoteTargets(section.children),
  ])
}

function SectionStepList({ section, onSave, onRemove }: { section: RecipeSectionView; onSave: (step: RecipeStepView, text: string) => Promise<void>; onRemove: (step: RecipeStepView) => void }) {
  return (
    <div className="recipe-section-block" data-depth={section.depth}>
      <h3 className="recipe-section-title">{section.title}</h3>
      {section.notes.length > 0 && <div className="recipe-section-notes">{section.notes.map((note) => <p key={note.id}><span>Note</span><CooklangText text={note.text} /></p>)}</div>}
      {section.steps.length > 0 && <ol className="recipe-step-list">{section.steps.map((step, index) => <StepEditor key={step.id} step={step} displayIndex={index + 1} onSave={(text) => onSave(step, text)} onRemove={() => onRemove(step)} />)}</ol>}
      {section.children.map((child) => <SectionStepList key={child.id} section={child} onSave={onSave} onRemove={onRemove} />)}
    </div>
  )
}

function SectionIngredientGroups({ sections, scaleFactor }: { sections: RecipeSectionView[]; scaleFactor: number }) {
  return <>{sections.map((section) => <div className="recipe-derived-group" key={section.id}>{section.ingredients.length > 0 && <><h3>{section.title}</h3><IngredientList ingredients={section.ingredients} scaleFactor={scaleFactor} /></>}{section.children.length > 0 && <SectionIngredientGroups sections={section.children} scaleFactor={scaleFactor} />}</div>)}</>
}

function SectionCookwareGroups({ sections }: { sections: RecipeSectionView[] }) {
  return <>{sections.map((section) => <div className="recipe-derived-group" key={section.id}>{section.cookware.length > 0 && <><h3>{section.title}</h3><ul className="recipe-cookware-list">{section.cookware.map((item) => <li key={item}>{item}</li>)}</ul></>}{section.children.length > 0 && <SectionCookwareGroups sections={section.children} />}</div>)}</>
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
  const [deleting, setDeleting] = useState(false)
  const [activePanel, setActivePanel] = useState<RecipePanel>('ingredients')
  const [newStepSectionId, setNewStepSectionId] = useState('')
  const [newSectionParentId, setNewSectionParentId] = useState('')
  const [newSectionTitle, setNewSectionTitle] = useState('')
  const [newNote, setNewNote] = useState('')
  const [newNoteParentId, setNewNoteParentId] = useState('')

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
  const recipeId = threadId.replace(/[^a-zA-Z0-9_-]/g, '-')
  const tabId = (panel: RecipePanel) => `recipe-${recipeId}-${panel}-tab`
  const panelId = (panel: RecipePanel) => `recipe-${recipeId}-${panel}-panel`

  const submitNewStep = async () => {
    if (!newStep.trim()) return
    setAddingStep(true)
    try {
      if (newStepSectionId) await addStepToSection(threadId, newStepSectionId, newStep)
      else await addStep(threadId, newStep)
      setNewStep('')
    } finally {
      setAddingStep(false)
    }
  }

  const submitNewSection = async () => {
    if (!newSectionTitle.trim()) return
    await addSection(threadId, newSectionTitle, newSectionParentId || undefined)
    setNewSectionTitle('')
  }

  const submitNewNote = async () => {
    if (!newNote.trim()) return
    await addNote(threadId, newNote, newNoteParentId || undefined)
    setNewNote('')
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

  const deleteRecipe = async () => {
    if (!window.confirm(`Delete "${recipe.thread.title}"? This cannot be undone.`)) return
    setDeleting(true)
    setCookError(null)
    try {
      await deleteRecipeThread(threadId)
      navigate('/recipes')
    } catch (caught) {
      setCookError(caught instanceof Error ? caught.message : String(caught))
      setDeleting(false)
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
        <div className="recipe-page-hero-actions">
          <Button disabled={starting || !recipe.steps.length} onClick={() => void startCooking()}>
            <ChefHat size={16} aria-hidden="true" /> Start cooking
          </Button>
          <Button variant="danger" iconOnly className="recipe-delete" aria-label="Delete recipe" disabled={deleting} onClick={() => void deleteRecipe()}>
            <Trash2 size={16} aria-hidden="true" />
          </Button>
        </div>
      </header>
      {cookError && <p className="add-exercise-error" role="alert">{cookError}</p>}

      <div className="recipe-content-tabs" role="tablist" aria-label="Recipe details">
        <button
          type="button"
          role="tab"
          id={tabId('ingredients')}
          aria-controls={panelId('ingredients')}
          aria-selected={activePanel === 'ingredients'}
          onClick={() => setActivePanel('ingredients')}
        >
          Ingredients
        </button>
        <button
          type="button"
          role="tab"
          id={tabId('cookware')}
          aria-controls={panelId('cookware')}
          aria-selected={activePanel === 'cookware'}
          onClick={() => setActivePanel('cookware')}
        >
          Cookware
        </button>
        <button
          type="button"
          role="tab"
          id={tabId('steps')}
          aria-controls={panelId('steps')}
          aria-selected={activePanel === 'steps'}
          onClick={() => setActivePanel('steps')}
        >
          Steps
        </button>
      </div>

      <section id={panelId('ingredients')} className={`recipe-ingredients-panel recipe-tab-panel${activePanel === 'ingredients' ? ' is-active' : ''}`} role="tabpanel" aria-labelledby={tabId('ingredients')}>
        <header className="recipe-panel-head">
          <h2>Ingredients</h2>
          <div className="recipe-servings-scaler" aria-label="Servings">
            <Button variant="ghost" size="sm" iconOnly onClick={() => changeServings(servings - 1)} aria-label="Fewer servings"><Minus size={14} aria-hidden="true" /></Button>
            <span>{servings} serving{servings === 1 ? '' : 's'}</span>
            <Button variant="ghost" size="sm" iconOnly onClick={() => changeServings(servings + 1)} aria-label="More servings"><Plus size={14} aria-hidden="true" /></Button>
          </div>
        </header>
        {recipe.ingredients.length ? (
          <>
            {recipe.sections.length > 0 && <SectionIngredientGroups sections={recipe.sections} scaleFactor={scaleFactor} />}
            {recipe.sections.length > 0 && recipe.unsectionedSteps.length > 0 && <div className="recipe-derived-group"><h3>Other</h3><IngredientList ingredients={recipe.unsectionedSteps.flatMap((step) => step.ingredients)} scaleFactor={scaleFactor} /></div>}
            {recipe.sections.length === 0 && <IngredientList ingredients={recipe.ingredients} scaleFactor={scaleFactor} />}
          </>
        ) : (
          <p className="section-empty">Add steps with <code>@ingredient{'{'}qty%unit{'}'}</code> tokens and they will show up here automatically.</p>
        )}
      </section>

      <section id={panelId('cookware')} className={`recipe-cookware-panel recipe-tab-panel${activePanel === 'cookware' ? ' is-active' : ''}`} role="tabpanel" aria-labelledby={tabId('cookware')}>
        <h2>Cookware</h2>
        {recipe.cookware.length ? (
          <>
            {recipe.sections.length > 0 && <SectionCookwareGroups sections={recipe.sections} />}
            {recipe.sections.length > 0 && recipe.unsectionedSteps.length > 0 && <div className="recipe-derived-group"><h3>Other</h3><ul className="recipe-cookware-list">{uniqueStrings(recipe.unsectionedSteps.flatMap((step) => step.cookware)).map((item) => <li key={item}>{item}</li>)}</ul></div>}
            {recipe.sections.length === 0 && <ul className="recipe-cookware-list">{recipe.cookware.map((item) => <li key={item}>{item}</li>)}</ul>}
          </>
        ) : (
          <p className="section-empty">Add cookware with <code>^pan{'{}'}</code> tokens in recipe steps and it will show up here automatically.</p>
        )}
      </section>

      <section id={panelId('steps')} className={`recipe-steps-panel recipe-tab-panel${activePanel === 'steps' ? ' is-active' : ''}`} role="tabpanel" aria-labelledby={tabId('steps')}>
        <h2>Steps</h2>
        {recipe.steps.length || recipe.sections.length || recipe.unsectionedNotes.length ? (
          <>
            {recipe.sections.map((section) => <SectionStepList key={section.id} section={section} onSave={(step, text) => updateStep(threadId, step.index, text)} onRemove={(step) => void removeStep(threadId, step.index)} />)}
            {recipe.unsectionedSteps.length > 0 && <div className="recipe-section-block recipe-section-ungrouped"><h3 className="recipe-section-title">Other steps</h3><ol className="recipe-step-list">{recipe.unsectionedSteps.map((step, index) => <StepEditor key={step.id} step={step} displayIndex={index + 1} onSave={(text) => updateStep(threadId, step.index, text)} onRemove={() => void removeStep(threadId, step.index)} />)}</ol></div>}
            {recipe.unsectionedNotes.length > 0 && <div className="recipe-section-notes">{recipe.unsectionedNotes.map((note) => <p key={note.id}><span>Note</span><CooklangText text={note.text} /></p>)}</div>}
          </>
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
          {flattenSections(recipe.sections).length > 0 && <select value={newStepSectionId} onChange={(event) => setNewStepSectionId(event.target.value)} aria-label="Add step to section">
            <option value="">Recipe root</option>
            {flattenSections(recipe.sections).map((section) => <option key={section.id} value={section.id}>{'— '.repeat(Math.max(0, Math.floor(section.depth / 2)))}{section.title}</option>)}
          </select>}
          <input
            value={newStep}
            onChange={(event) => setNewStep(event.target.value)}
            placeholder="Whisk @eggs{2} and @milk{300%ml} together."
            aria-label="New step"
          />
          <Button type="submit" disabled={addingStep || !newStep.trim()}><Plus size={14} aria-hidden="true" /> Add step</Button>
        </form>
        <div className="recipe-authoring-tools">
          <form className="recipe-inline-form" onSubmit={(event) => { event.preventDefault(); void submitNewSection() }}>
            <select value={newSectionParentId} onChange={(event) => setNewSectionParentId(event.target.value)} aria-label="Add section under">
              <option value="">Recipe root</option>
              {flattenSections(recipe.sections).map((section) => <option key={section.id} value={section.id}>{'— '.repeat(Math.max(0, Math.floor(section.depth / 2)))}{section.title}</option>)}
            </select>
            <input value={newSectionTitle} onChange={(event) => setNewSectionTitle(event.target.value)} placeholder="New section name" aria-label="New section name" />
            <Button type="submit" variant="outline" disabled={!newSectionTitle.trim()}><Plus size={14} aria-hidden="true" /> Add section</Button>
          </form>
          <form className="recipe-inline-form" onSubmit={(event) => { event.preventDefault(); void submitNewNote() }}>
            <select value={newNoteParentId} onChange={(event) => setNewNoteParentId(event.target.value)} aria-label="Add note to">
              <option value="">Recipe note</option>
              {[
                ...flattenNoteTargets(recipe.sections),
                ...recipe.unsectionedSteps.map((step, index) => ({ id: step.id, label: `Step ${index + 1}: ${step.text}` })),
              ].map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
            </select>
            <input value={newNote} onChange={(event) => setNewNote(event.target.value)} placeholder="Add a cooking note" aria-label="New cooking note" />
            <Button type="submit" variant="outline" disabled={!newNote.trim()}>Add note</Button>
          </form>
        </div>
      </section>
    </article>
  )
}
