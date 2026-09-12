import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChefHat, Minus, Plus, Trash2 } from 'lucide-react'
import { CooklangText } from '../components/recipes/CooklangText'
import { formatQuantity, mergeIngredients, scaleIngredient } from '../lib/recipes/cooklangTokens'
import { isoToday } from '../lib/dates'
import { ActiveCookConflictError, startCook } from '../lib/recipes/lifecycle'
import { addNote, addSection, addStep, addStepToSection, convertUnsectionedStepsToSection, deleteRecipeThread, removeNote, removeSection, removeStep, updateNote, updateStep } from '../lib/recipes/mutations'
import { getRecipe } from '../lib/recipes/selectors'
import type { RecipeIngredient } from '../lib/recipes/cooklangTokens'
import type { RecipeSectionView, RecipeStepView } from '../lib/recipes/types'
import { Button, Input } from 'fiber'

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

function NoteEditor({ note, onSave, onRemove }: { note: { id: string; text: string }; onSave: (text: string) => Promise<void>; onRemove: () => Promise<void> }) {
  const [text, setText] = useState(note.text)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const commit = async () => {
    if (!text.trim() || text === note.text) { setEditing(false); return }
    setSaving(true)
    try {
      await onSave(text)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="recipe-note-row">
      <span className="recipe-note-label">Note</span>
      {editing ? (
        <div className="recipe-note-edit">
          <textarea
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            onBlur={(event) => {
              const next = event.relatedTarget
              if (next instanceof HTMLElement && next.closest('.recipe-note-edit-actions')) return
              void commit()
            }}
            disabled={saving}
            aria-label="Edit note"
          />
          <div className="recipe-note-edit-actions">
            <Button type="button" variant="danger" size="sm" iconOnly className="recipe-note-remove" aria-label="Delete note" onMouseDown={(event) => event.preventDefault()} onClick={() => void onRemove()} disabled={saving}><Trash2 size={13} aria-hidden="true" /></Button>
          </div>
        </div>
      ) : (
        <Button unstyled type="button" className="recipe-note-content" onClick={() => setEditing(true)}>{<CooklangText text={note.text} />}</Button>
      )}
    </div>
  )
}

function StepEditor({ step, displayIndex, onSave, onRemove, onAddNote, onSaveNote, onRemoveNote }: { step: RecipeStepView; displayIndex: number; onSave: (text: string) => Promise<void>; onRemove: () => void; onAddNote: (text: string) => Promise<void>; onSaveNote: (note: { id: string; text: string }, text: string) => Promise<void>; onRemoveNote: (note: { id: string; text: string }) => Promise<void> }) {
  const [text, setText] = useState(step.text)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [addingNote, setAddingNote] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)

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

  const commitNote = async () => {
    if (!noteText.trim()) return
    setSavingNote(true)
    try {
      await onAddNote(noteText)
      setNoteText('')
      setAddingNote(false)
    } finally {
      setSavingNote(false)
    }
  }

  return (
    <li className="recipe-step-row">
      <span className="recipe-step-number">{displayIndex}</span>
      {editing ? (
        <div className="recipe-step-edit-stack">
          <textarea
            className="recipe-step-input"
            value={text}
            autoFocus
            onChange={(event) => setText(event.target.value)}
            onBlur={(event) => {
              const next = event.relatedTarget
              if (next instanceof HTMLElement && next.closest('.recipe-step-edit-actions')) return
              void commit()
            }}
            disabled={saving}
          />
          <div className="recipe-step-edit-actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setAddingNote(true)}
              disabled={saving || savingNote}
            >
              <Plus size={14} aria-hidden="true" /> Note
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              iconOnly
              className="recipe-step-remove"
              aria-label="Remove step"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onRemove}
              disabled={saving || savingNote}
            >
              <Trash2 size={14} aria-hidden="true" />
            </Button>
            {addingNote && (
              <form className="recipe-step-note-form" onSubmit={(event) => { event.preventDefault(); void commitNote() }}>
                <Input
                  autoFocus
                  value={noteText}
                  onChange={(event) => setNoteText(event.target.value)}
                  placeholder="Add a note for this step"
                  aria-label="New note for step"
                  disabled={savingNote}
                />
                <Button type="submit" size="sm" disabled={savingNote || !noteText.trim()}>Save note</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setAddingNote(false); setNoteText('') }} disabled={savingNote}>Cancel</Button>
              </form>
            )}
          </div>
        </div>
      ) : (
        <p className="recipe-step-text" onClick={() => setEditing(true)}><CooklangText text={step.text} /></p>
      )}
      {step.notes.length > 0 && <div className="recipe-step-notes">{step.notes.map((note) => <NoteEditor key={note.id} note={note} onSave={(text) => onSaveNote(note, text)} onRemove={() => onRemoveNote(note)} />)}</div>}
    </li>
  )
}

function flattenSections(sections: RecipeSectionView[]): RecipeSectionView[] {
  return sections.flatMap((section) => [section, ...flattenSections(section.children)])
}

function ingredientKey(ingredient: RecipeIngredient): string {
  return `${ingredient.name.toLocaleLowerCase()}\u0000${ingredient.preparation?.toLocaleLowerCase() ?? ''}`
}

function ingredientAmount(ingredient: RecipeIngredient, scaleFactor: number): string {
  const scaled = scaleIngredient(ingredient, scaleFactor)
  return [scaled.quantity !== undefined ? formatQuantity(scaled.quantity) : undefined, scaled.unit].filter(Boolean).join(' ') || 'as needed'
}

function IngredientTotals({ ingredients, sections, unsectionedSteps, scaleFactor }: { ingredients: RecipeIngredient[]; sections: RecipeSectionView[]; unsectionedSteps: RecipeStepView[]; scaleFactor: number }) {
  const sectionList = flattenSections(sections)
  const otherIngredients = mergeIngredients(unsectionedSteps.flatMap((step) => step.ingredients))

  return (
    <ul className="recipe-ingredient-total-list">
      {ingredients.map((ingredient) => {
        const key = ingredientKey(ingredient)
        const sectionUsages = sectionList.flatMap((section) => {
          const usage = section.ingredients.find((candidate) => ingredientKey(candidate) === key)
          return usage ? [{ id: section.id, label: section.title, ingredient: usage }] : []
        })
        const usages = [...sectionUsages]
        const otherUsage = otherIngredients.find((candidate) => ingredientKey(candidate) === key)
        if (otherUsage) usages.push({ id: 'other', label: 'Other', ingredient: otherUsage })
        const showBreakdown = usages.length > 1
        return (
          <li key={key} className="recipe-ingredient-total-item">
            <div className="recipe-ingredient-total-row">
              <span className="recipe-ingredient-name">{ingredient.name}{ingredient.preparation ? ` (${ingredient.preparation})` : ''}</span>
              <span className="recipe-ingredient-total-amount">— {ingredientAmount(ingredient, scaleFactor)}</span>
            </div>
            {showBreakdown && <ul className="recipe-ingredient-usage-list">{usages.map((usage) => <li key={`${key}:${usage.id}`}><span aria-hidden="true">↳</span> {usage.label} {ingredientAmount(usage.ingredient, scaleFactor)}</li>)}</ul>}
          </li>
        )
      })}
    </ul>
  )
}

function SectionForm({ title, onChange, onSubmit, onCancel, saving, submitLabel = 'Add section', savingLabel = 'Adding…' }: { title: string; onChange: (value: string) => void; onSubmit: () => void; onCancel: () => void; saving: boolean; submitLabel?: string; savingLabel?: string }) {
  return (
    <form className="recipe-section-form" onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
      <Input autoFocus value={title} onChange={(event) => onChange(event.target.value)} placeholder="New section name" aria-label="New section name" disabled={saving} />
      <Button type="submit" size="sm" disabled={saving || !title.trim()}>{saving ? savingLabel : submitLabel}</Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
    </form>
  )
}

function SectionStepList({ section, onSave, onRemove, onAddNote, onSaveNote, onRemoveNote, onRequestAddSection, onRemoveSection, activeSectionFormId, sectionTitle, onSectionTitleChange, onSubmitSection, onCancelSection, addingSection }: { section: RecipeSectionView; onSave: (step: RecipeStepView, text: string) => Promise<void>; onRemove: (step: RecipeStepView) => void; onAddNote: (step: RecipeStepView, text: string) => Promise<void>; onSaveNote: (note: { id: string; text: string }, text: string) => Promise<void>; onRemoveNote: (note: { id: string; text: string }) => Promise<void>; onRequestAddSection: (sectionId: string) => void; onRemoveSection: (section: RecipeSectionView) => Promise<void>; activeSectionFormId: string | null; sectionTitle: string; onSectionTitleChange: (value: string) => void; onSubmitSection: () => void; onCancelSection: () => void; addingSection: boolean }) {
  return (
    <div className="recipe-section-block" data-depth={section.depth}>
      <div className="recipe-section-heading">
        <h3 className="recipe-section-title">{section.title}</h3>
        <Button type="button" variant="ghost" size="sm" iconOnly className="recipe-section-add" aria-label={`Add nested section under ${section.title}`} onClick={() => onRequestAddSection(section.id)}><Plus size={15} aria-hidden="true" /></Button>
        <Button type="button" variant="danger" size="sm" iconOnly className="recipe-section-remove" aria-label={`Delete section ${section.title}`} onClick={() => void onRemoveSection(section)}><Trash2 size={14} aria-hidden="true" /></Button>
      </div>
      {activeSectionFormId === section.id && <SectionForm title={sectionTitle} onChange={onSectionTitleChange} onSubmit={onSubmitSection} onCancel={onCancelSection} saving={addingSection} />}
      {section.notes.length > 0 && <div className="recipe-section-notes">{section.notes.map((note) => <NoteEditor key={note.id} note={note} onSave={(text) => onSaveNote(note, text)} onRemove={() => onRemoveNote(note)} />)}</div>}
      {section.steps.length > 0 && <ol className="recipe-step-list">{section.steps.map((step, index) => <StepEditor key={step.id} step={step} displayIndex={index + 1} onSave={(text) => onSave(step, text)} onRemove={() => onRemove(step)} onAddNote={(text) => onAddNote(step, text)} onSaveNote={onSaveNote} onRemoveNote={onRemoveNote} />)}</ol>}
      {section.children.map((child) => <SectionStepList key={child.id} section={child} onSave={onSave} onRemove={onRemove} onAddNote={onAddNote} onSaveNote={onSaveNote} onRemoveNote={onRemoveNote} onRequestAddSection={onRequestAddSection} onRemoveSection={onRemoveSection} activeSectionFormId={activeSectionFormId} sectionTitle={sectionTitle} onSectionTitleChange={onSectionTitleChange} onSubmitSection={onSubmitSection} onCancelSection={onCancelSection} addingSection={addingSection} />)}
    </div>
  )
}

function CookwareTotals({ cookware, sections, unsectionedSteps }: { cookware: string[]; sections: RecipeSectionView[]; unsectionedSteps: RecipeStepView[] }) {
  const sectionList = flattenSections(sections)
  const otherCookware = uniqueStrings(unsectionedSteps.flatMap((step) => step.cookware))

  return (
    <ul className="recipe-cookware-total-list">
      {cookware.map((item) => {
        const key = item.toLocaleLowerCase()
        const usages = sectionList
          .filter((section) => section.cookware.some((candidate) => candidate.toLocaleLowerCase() === key))
          .map((section) => ({ id: section.id, label: section.title }))
        const inOther = otherCookware.some((candidate) => candidate.toLocaleLowerCase() === key)
        if (inOther) usages.push({ id: 'other', label: 'Other' })
        const showBreakdown = usages.length > 1
        return (
          <li key={item} className="recipe-cookware-total-item">
            <div className="recipe-cookware-total-row">{item}</div>
            {showBreakdown && <ul className="recipe-cookware-usage-list">{usages.map((usage) => <li key={`${key}:${usage.id}`}><span aria-hidden="true">↳</span> {usage.label}</li>)}</ul>}
          </li>
        )
      })}
    </ul>
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
  const [deleting, setDeleting] = useState(false)
  const [activePanel, setActivePanel] = useState<RecipePanel>('ingredients')
  const [newStepSectionId, setNewStepSectionId] = useState('')
  const [newSectionParentId, setNewSectionParentId] = useState<string | null>(null)
  const [newSectionTitle, setNewSectionTitle] = useState('')
  const [addingSection, setAddingSection] = useState(false)
  const [convertingOtherSteps, setConvertingOtherSteps] = useState(false)

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
    setAddingSection(true)
    setCookError(null)
    try {
      await addSection(threadId, newSectionTitle, newSectionParentId || undefined)
      setNewSectionTitle('')
      setNewSectionParentId(null)
    } catch (caught) {
      setCookError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setAddingSection(false)
    }
  }

  const openSectionForm = (parentId: string) => {
    setConvertingOtherSteps(false)
    setNewSectionParentId(parentId)
    setNewSectionTitle('')
  }

  const openConvertOtherSteps = () => {
    setNewSectionParentId(null)
    setNewSectionTitle('')
    setConvertingOtherSteps(true)
  }

  const submitConvertOtherSteps = async () => {
    if (!newSectionTitle.trim()) return
    setAddingSection(true)
    setCookError(null)
    try {
      await convertUnsectionedStepsToSection(threadId, newSectionTitle)
      setNewSectionTitle('')
      setConvertingOtherSteps(false)
    } catch (caught) {
      setCookError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setAddingSection(false)
    }
  }

  const addNoteToStep = async (step: RecipeStepView, text: string) => {
    try {
      await addNote(threadId, text, step.id)
      setCookError(null)
    } catch (caught) {
      setCookError(caught instanceof Error ? caught.message : String(caught))
      throw caught
    }
  }

  const saveRecipeNote = async (note: { id: string; text: string }, text: string) => {
    try {
      await updateNote(threadId, note.id, text)
      setCookError(null)
    } catch (caught) {
      setCookError(caught instanceof Error ? caught.message : String(caught))
      throw caught
    }
  }

  const deleteRecipeNote = async (note: { id: string; text: string }) => {
    if (!window.confirm('Delete this note? This cannot be undone.')) return
    try {
      await removeNote(threadId, note.id)
      setCookError(null)
    } catch (caught) {
      setCookError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const deleteRecipeSection = async (section: RecipeSectionView) => {
    const contents = section.steps.length + section.children.length + section.notes.length
    const suffix = contents > 0 ? ' Its steps, notes, and nested sections will also be deleted.' : ''
    if (!window.confirm(`Delete the “${section.title}” section?${suffix}`)) return
    try {
      await removeSection(threadId, section.id)
      setNewSectionParentId(null)
      setNewSectionTitle('')
      setCookError(null)
    } catch (caught) {
      setCookError(caught instanceof Error ? caught.message : String(caught))
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
        <Button unstyled
          type="button"
          role="tab"
          id={tabId('ingredients')}
          aria-controls={panelId('ingredients')}
          aria-selected={activePanel === 'ingredients'}
          onClick={() => setActivePanel('ingredients')}
        >
          Ingredients
        </Button>
        <Button unstyled
          type="button"
          role="tab"
          id={tabId('cookware')}
          aria-controls={panelId('cookware')}
          aria-selected={activePanel === 'cookware'}
          onClick={() => setActivePanel('cookware')}
        >
          Cookware
        </Button>
        <Button unstyled
          type="button"
          role="tab"
          id={tabId('steps')}
          aria-controls={panelId('steps')}
          aria-selected={activePanel === 'steps'}
          onClick={() => setActivePanel('steps')}
        >
          Steps
        </Button>
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
          <IngredientTotals ingredients={recipe.ingredients} sections={recipe.sections} unsectionedSteps={recipe.unsectionedSteps} scaleFactor={scaleFactor} />
        ) : (
          <p className="section-empty">Add steps with <code>@ingredient{'{'}qty%unit{'}'}</code> tokens and they will show up here automatically.</p>
        )}
      </section>

      <section id={panelId('cookware')} className={`recipe-cookware-panel recipe-tab-panel${activePanel === 'cookware' ? ' is-active' : ''}`} role="tabpanel" aria-labelledby={tabId('cookware')}>
        <h2>Cookware</h2>
        {recipe.cookware.length ? (
          <CookwareTotals cookware={recipe.cookware} sections={recipe.sections} unsectionedSteps={recipe.unsectionedSteps} />
        ) : (
          <p className="section-empty">Add cookware with <code>^pan{'{}'}</code> tokens in recipe steps and it will show up here automatically.</p>
        )}
      </section>

      <section id={panelId('steps')} className={`recipe-steps-panel recipe-tab-panel${activePanel === 'steps' ? ' is-active' : ''}`} role="tabpanel" aria-labelledby={tabId('steps')}>
        <div className="recipe-panel-title-row">
          <h2>Steps</h2>
          <Button type="button" variant="outline" size="sm" onClick={() => openSectionForm('')}><Plus size={14} aria-hidden="true" /> Add section</Button>
        </div>
        {newSectionParentId === '' && <SectionForm title={newSectionTitle} onChange={setNewSectionTitle} onSubmit={() => void submitNewSection()} onCancel={() => { setNewSectionParentId(null); setNewSectionTitle('') }} saving={addingSection} />}
        {recipe.steps.length || recipe.sections.length || recipe.unsectionedNotes.length ? (
          <>
            {recipe.sections.map((section) => <SectionStepList key={section.id} section={section} onSave={(step, text) => updateStep(threadId, step.index, text)} onRemove={(step) => void removeStep(threadId, step.index)} onAddNote={addNoteToStep} onSaveNote={saveRecipeNote} onRemoveNote={deleteRecipeNote} onRequestAddSection={openSectionForm} onRemoveSection={deleteRecipeSection} activeSectionFormId={newSectionParentId} sectionTitle={newSectionTitle} onSectionTitleChange={setNewSectionTitle} onSubmitSection={() => void submitNewSection()} onCancelSection={() => { setNewSectionParentId(null); setNewSectionTitle('') }} addingSection={addingSection} />)}
            {recipe.unsectionedSteps.length > 0 && <div className="recipe-section-block recipe-section-ungrouped"><div className="recipe-section-heading"><h3 className="recipe-section-title">General steps</h3><Button type="button" variant="outline" size="sm" className="recipe-section-convert" onClick={openConvertOtherSteps}>Convert to section</Button></div>{convertingOtherSteps && <SectionForm title={newSectionTitle} onChange={setNewSectionTitle} onSubmit={() => void submitConvertOtherSteps()} onCancel={() => { setConvertingOtherSteps(false); setNewSectionTitle('') }} saving={addingSection} submitLabel="Convert to section" savingLabel="Converting…" />}<ol className="recipe-step-list">{recipe.unsectionedSteps.map((step, index) => <StepEditor key={step.id} step={step} displayIndex={index + 1} onSave={(text) => updateStep(threadId, step.index, text)} onRemove={() => void removeStep(threadId, step.index)} onAddNote={(text) => addNoteToStep(step, text)} onSaveNote={saveRecipeNote} onRemoveNote={deleteRecipeNote} />)}</ol></div>}
            {recipe.unsectionedNotes.length > 0 && <div className="recipe-section-notes">{recipe.unsectionedNotes.map((note) => <NoteEditor key={note.id} note={note} onSave={(text) => saveRecipeNote(note, text)} onRemove={() => deleteRecipeNote(note)} />)}</div>}
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
          <Input
            value={newStep}
            onChange={(event) => setNewStep(event.target.value)}
            placeholder="Whisk @eggs{2} and @milk{300%ml} together."
            aria-label="New step"
          />
          <Button type="submit" disabled={addingStep || !newStep.trim()}><Plus size={14} aria-hidden="true" /> Add step</Button>
        </form>
      </section>
    </article>
  )
}
