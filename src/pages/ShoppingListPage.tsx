import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ShoppingCart } from 'lucide-react'
import { formatQuantity } from '../lib/recipes/cooklangTokens'
import { formatShortDate, isoToday, shiftDay } from '../lib/dates'
import { getShoppingList } from '../lib/recipes/selectors'

export function ShoppingListPage() {
  const [params, setParams] = useSearchParams()
  const today = isoToday()
  const startDay = params.get('start') ?? today
  const endDay = params.get('end') ?? shiftDay(today, 6)
  const list = useLiveQuery(() => getShoppingList(startDay, endDay), [startDay, endDay])
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const setRange = (key: 'start' | 'end', value: string) => setParams((current) => {
    const next = new URLSearchParams(current)
    next.set(key, value)
    return next
  })

  const toggle = (name: string) => setChecked((current) => {
    const next = new Set(current)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    return next
  })

  const sorted = useMemo(() => [...(list ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [list])

  if (list === undefined) return <div className="page-loading">Loading shopping list…</div>

  return (
    <article className="shopping-list-page">
      <Link to="/meal-plan" className="back-link"><ArrowLeft size={15} aria-hidden="true" /> Meal plan</Link>
      <header className="shopping-list-hero">
        <div><h1>Shopping list</h1><p>Every ingredient from your planned meals, combined.</p></div>
      </header>

      <div className="shopping-list-range">
        <label>From <input type="date" value={startDay} onChange={(event) => setRange('start', event.target.value)} /></label>
        <label>To <input type="date" value={endDay} onChange={(event) => setRange('end', event.target.value)} /></label>
        <span>{formatShortDate(startDay)} – {formatShortDate(endDay)}</span>
      </div>

      {sorted.length === 0 ? (
        <div className="shopping-list-empty">
          <ShoppingCart size={24} aria-hidden="true" />
          <h2>Nothing planned yet</h2>
          <p>Plan a meal in this range and its ingredients will show up here.</p>
        </div>
      ) : (
        <ul className="shopping-list">
          {sorted.map((item) => (
            <li key={item.name} className={checked.has(item.name) ? 'checked' : ''}>
              <label>
                <input type="checkbox" checked={checked.has(item.name)} onChange={() => toggle(item.name)} />
                {item.quantity !== undefined && <span className="shopping-list-quantity">{formatQuantity(item.quantity)}{item.unit ? ` ${item.unit}` : ''}</span>}
                <span className="shopping-list-name">{item.name}</span>
                {item.quantity === undefined && item.plannedCount > 1 && <span className="shopping-list-count">×{item.plannedCount}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
