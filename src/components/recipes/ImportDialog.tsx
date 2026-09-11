import { useState } from 'react'
import { X } from 'lucide-react'
import { RECIPE_CATEGORY_OPTIONS } from '../../lib/blockMetadata'
import { importRecipeFromUrl, type RecipeImportDraft } from '../../lib/recipes/import'
import { addStep, createRecipeThread, updateRecipeProperties } from '../../lib/recipes/mutations'
import { Button } from '../ui'

interface ImportDialogProps {
  onClose: () => void
  onImported: (threadId: string) => void
}

type Stage = { kind: 'url' } | { kind: 'fetching' } | { kind: 'review'; draft: RecipeImportDraft } | { kind: 'saving' }

export function ImportDialog({ onClose, onImported }: ImportDialogProps) {
  const [url, setUrl] = useState('')
  const [stage, setStage] = useState<Stage>({ kind: 'url' })
  const [error, setError] = useState<string | null>(null)

  // Draft fields, editable once a fetch succeeds.
  const [title, setTitle] = useState('')
  const [servings, setServings] = useState('')
  const [prepMinutes, setPrepMinutes] = useState('')
  const [cookMinutes, setCookMinutes] = useState('')
  const [category, setCategory] = useState<string[]>([])
  const [stepsText, setStepsText] = useState('')

  const fetchDraft = async () => {
    setStage({ kind: 'fetching' })
    setError(null)
    try {
      const draft = await importRecipeFromUrl(url)
      setTitle(draft.title)
      setServings(draft.servings !== undefined ? String(draft.servings) : '')
      setPrepMinutes(draft.prepMinutes !== undefined ? String(draft.prepMinutes) : '')
      setCookMinutes(draft.cookMinutes !== undefined ? String(draft.cookMinutes) : '')
      setCategory(draft.category ?? [])
      setStepsText(draft.steps.join('\n'))
      setStage({ kind: 'review', draft })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setStage({ kind: 'url' })
    }
  }

  const toggleCategory = (id: string) => {
    setCategory((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  const save = async () => {
    if (stage.kind !== 'review') return
    if (!title.trim()) { setError('Give the recipe a title.'); return }
    const steps = stepsText.split('\n').map((line) => line.trim()).filter(Boolean)
    if (!steps.length) { setError('The recipe needs at least one step.'); return }

    setStage({ kind: 'saving' })
    setError(null)
    try {
      const threadId = await createRecipeThread({ title, servings: servings ? Number(servings) : undefined })
      await updateRecipeProperties(threadId, {
        prepMinutes: prepMinutes ? Number(prepMinutes) : null,
        cookMinutes: cookMinutes ? Number(cookMinutes) : null,
        category: category.length ? category : null,
        sourceUrl: stage.draft.sourceUrl,
      })
      for (const step of steps) await addStep(threadId, step)
      onImported(threadId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setStage({ kind: 'review', draft: stage.draft })
    }
  }

  return (
    <div className="layer-backdrop layer-backdrop-center recipes-import-backdrop">
      <div className="dialog recipes-import-dialog">
        <div className="recipes-import-head">
          <strong>Import a recipe</strong>
          <Button variant="ghost" size="sm" iconOnly aria-label="Close" onClick={onClose}><X size={16} /></Button>
        </div>

        {stage.kind === 'url' || stage.kind === 'fetching' ? (
          <>
            <label className="field">
              <span className="field-label">Recipe URL</span>
              <input
                className="field-control"
                autoFocus
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/some-recipe"
                disabled={stage.kind === 'fetching'}
              />
            </label>
            {error && <p className="banner banner-error" role="alert">{error}</p>}
            <div className="recipes-import-actions">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button disabled={!url.trim() || stage.kind === 'fetching'} onClick={() => void fetchDraft()}>
                {stage.kind === 'fetching' ? 'Fetching…' : 'Fetch recipe'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <label className="field">
              <span className="field-label">Title</span>
              <input className="field-control" value={title} onChange={(event) => setTitle(event.target.value)} disabled={stage.kind === 'saving'} />
            </label>
            <div className="recipes-import-numbers">
              <label className="field">
                <span className="field-label">Servings</span>
                <input className="field-control" type="number" min={1} value={servings} onChange={(event) => setServings(event.target.value)} disabled={stage.kind === 'saving'} />
              </label>
              <label className="field">
                <span className="field-label">Prep (min)</span>
                <input className="field-control" type="number" min={0} value={prepMinutes} onChange={(event) => setPrepMinutes(event.target.value)} disabled={stage.kind === 'saving'} />
              </label>
              <label className="field">
                <span className="field-label">Cook (min)</span>
                <input className="field-control" type="number" min={0} value={cookMinutes} onChange={(event) => setCookMinutes(event.target.value)} disabled={stage.kind === 'saving'} />
              </label>
            </div>
            <div className="field">
              <span className="field-label">Category</span>
              <div className="recipes-import-categories">
                {RECIPE_CATEGORY_OPTIONS.map((option) => (
                  <Button
                    variant="outline"
                    size="sm"
                    key={option.id}
                    className={category.includes(option.id) ? 'active' : ''}
                    onClick={() => toggleCategory(option.id)}
                    disabled={stage.kind === 'saving'}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
            <label className="field">
              <span className="field-label">Steps (one per line, edit freely)</span>
              <textarea
                className="field-control recipes-import-steps"
                value={stepsText}
                onChange={(event) => setStepsText(event.target.value)}
                disabled={stage.kind === 'saving'}
                rows={8}
              />
              <span className="field-hint">Review the ingredient/timer annotations the AI added before saving.</span>
            </label>
            {error && <p className="banner banner-error" role="alert">{error}</p>}
            <div className="recipes-import-actions">
              <Button variant="outline" onClick={onClose} disabled={stage.kind === 'saving'}>Cancel</Button>
              <Button disabled={stage.kind === 'saving'} onClick={() => void save()}>
                {stage.kind === 'saving' ? 'Saving…' : 'Save recipe'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
