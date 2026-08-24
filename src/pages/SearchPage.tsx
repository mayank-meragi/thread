import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db } from '../db'
import { formatDay } from '../lib/dates'
import { searchDays } from '../lib/search'

export function SearchPage() {
  const [query, setQuery] = useState('')
  const days = useLiveQuery(() => db.days.orderBy('date').reverse().toArray(), [], [])
  const threads = useLiveQuery(() => db.threads.orderBy('updatedAt').reverse().toArray(), [], [])
  const normalized = query.trim().toLocaleLowerCase()
  const results = useMemo(() => searchDays(days, normalized), [days, normalized])

  return (
    <article className="utility-page">
      <div className="eyebrow">Everything you have written</div>
      <h1>Search</h1>
      <label className="search-box">
        <Search size={18} />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search blocks and threads" />
        <kbd>⌘ K</kbd>
      </label>

      {!normalized && <>
        <h2>Recent threads</h2>
        <div className="thread-cards">
          {threads.map((thread) => <Link to={`/thread/${thread.id}`} key={thread.id}><span className="thread-dot" />{thread.title}</Link>)}
        </div>
      </>}

      {normalized && <div className="search-results">
        <div className="section-label"><span>Journal days</span><small>{results.length}</small></div>
        {results.map((day) => (
          <div className="search-result" key={day.date}>
            <small>{formatDay(day.date).weekday}, {formatDay(day.date).full}</small>
            <p>{day.matchLine}</p>
          </div>
        ))}
        {results.length === 0 && <p className="empty-hint">No notes match “{query}”.</p>}
      </div>}
    </article>
  )
}
