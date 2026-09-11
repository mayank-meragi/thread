import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router-dom'
import { BookOpen, CalendarDays, ChefHat, Download, Plus, Search } from 'lucide-react'
import { ImportDialog } from '../components/recipes/ImportDialog'
import { createRecipeThread } from '../lib/recipes/mutations'
import { listRecipes } from '../lib/recipes/selectors'
import type { RecipeView } from '../lib/recipes/types'
import { Button, ButtonLink } from '../components/ui'

function RecipeCard({ recipe }: { recipe: RecipeView }) {
  const servings = recipe.properties.get('recipe-servings')
  const prep = recipe.properties.get('recipe-prep-minutes')
  const cook = recipe.properties.get('recipe-cook-minutes')
  const imageUrl = recipe.properties.get('recipe-image-url')
  return (
    <Link className="recipe-card" to={`/recipe/${recipe.thread.id}`}>
      {typeof imageUrl === 'string' && imageUrl ? (
        <img className="recipe-card-image" src={imageUrl} alt="" />
      ) : (
        <div className="recipe-card-image recipe-card-image-empty"><ChefHat size={22} aria-hidden="true" /></div>
      )}
      <div className="recipe-card-body">
        <h3>{recipe.thread.title}</h3>
        <p className="recipe-card-meta">
          {recipe.steps.length} step{recipe.steps.length === 1 ? '' : 's'}
          {typeof servings === 'number' ? ` · ${servings} servings` : ''}
          {typeof prep === 'number' || typeof cook === 'number' ? ` · ${(Number(prep) || 0) + (Number(cook) || 0)} min` : ''}
        </p>
      </div>
    </Link>
  )
}

export function RecipesPage() {
  const recipes = useLiveQuery(() => listRecipes(), [])
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return recipes ?? []
    return (recipes ?? []).filter((recipe) => recipe.thread.title.toLocaleLowerCase().includes(needle))
  }, [recipes, query])

  const submitNewRecipe = async () => {
    if (!title.trim()) return
    setBusy(true)
    setError(null)
    try {
      const threadId = await createRecipeThread({ title })
      setTitle('')
      navigate(`/recipe/${threadId}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  if (recipes === undefined) return <div className="page-loading">Loading recipes…</div>

  return (
    <article className="recipes-page">
      <header className="recipes-hero">
        <div><h1>Recipes</h1><p>Your personal recipe box.</p></div>
        <div className="recipes-hero-actions">
          <ButtonLink to="/docs/recipe-syntax" variant="outline" className="recipes-import-open">
            <BookOpen size={15} aria-hidden="true" /> Syntax guide
          </ButtonLink>
          <ButtonLink to="/meal-plan" variant="outline" className="recipes-import-open">
            <CalendarDays size={15} aria-hidden="true" /> Meal plan
          </ButtonLink>
          <Button variant="outline" className="recipes-import-open" onClick={() => setImportOpen(true)}>
            <Download size={15} aria-hidden="true" /> Import from URL
          </Button>
          <form
            className="recipes-new-form"
            onSubmit={(event) => {
              event.preventDefault()
              void submitNewRecipe()
            }}
          >
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="New recipe name" aria-label="New recipe name" />
            <Button type="submit" disabled={busy || !title.trim()}><Plus size={16} aria-hidden="true" /> New recipe</Button>
          </form>
        </div>
      </header>
      {error && <p className="add-exercise-error" role="alert">{error}</p>}
      {importOpen && (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          onImported={(threadId) => { setImportOpen(false); navigate(`/recipe/${threadId}`) }}
        />
      )}

      {recipes.length === 0 ? (
        <div className="recipes-empty">
          <ChefHat size={24} aria-hidden="true" />
          <h2>Start your recipe box</h2>
          <p>
            Write your first recipe as steps with <code>@ingredient{'{'}qty%unit{'}'}</code> annotations, and the
            ingredient list builds itself. See the <Link to="/docs/recipe-syntax">syntax guide</Link> for
            cookware (<code>#pan{'{'}{'}'}</code>) and timers (<code>~{'{'}5%minutes{'}'}</code>) too.
          </p>
        </div>
      ) : (
        <>
          <label className="workout-search recipes-search"><Search size={15} aria-hidden="true" /><span className="sr-only">Search recipes</span><input value={query} placeholder="Search recipes" onChange={(event) => setQuery(event.target.value)} /></label>
          <div className="recipes-grid">{filtered.map((recipe) => <RecipeCard key={recipe.thread.id} recipe={recipe} />)}</div>
        </>
      )}
    </article>
  )
}
