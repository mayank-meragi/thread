import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, CircleCheck, Link2, Sparkles } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, ensureDay, saveDay } from '../db'
import { formatDay, isoToday, shiftDay } from '../lib/dates'
import { getGitHubConfig, pullDay } from '../lib/github'
import { MarkdownEditor } from '../components/MarkdownEditor'
import { TodayTasks } from '../components/TodayTasks'

export function TodayPage() {
  const [date, setDate] = useState(isoToday)
  const day = useLiveQuery(() => db.days.get(date), [date])
  const mentions = useLiveQuery(() => db.mentions.where('day').equals(date).toArray(), [date], [])
  const pending = useLiveQuery(() => db.outbox.get(`day:${date}`), [date])

  useEffect(() => {
    let cancelled = false
    // Pull only after the local record is guaranteed to exist -- otherwise a
    // pull that lands mid-creation could race ensureDay's own write.
    void ensureDay(date).then(() => {
      if (!cancelled && getGitHubConfig()) void pullDay(date)
    })
    return () => {
      cancelled = true
    }
  }, [date])

  const handleChange = useCallback(
    (markdown: string) => {
      void saveDay(date, markdown)
    },
    [date],
  )

  // useLiveQuery can briefly retain the previous result while its dependency
  // changes. Never mount an editor until the record matches the selected day.
  if (!day || day.date !== date) return <div className="page-loading">Opening your journal…</div>

  const label = formatDay(date)
  const today = date === isoToday()

  return (
    <div className="today-grid">
      <article className="journal-page">
        <header className="day-heading">
          <div>
            <div className="eyebrow">{today ? 'Today' : label.weekday}</div>
            <h1>{label.weekday}, <span>{label.full}</span></h1>
          </div>
          <div className="day-actions" aria-label="Change day">
            <button type="button" onClick={() => setDate(shiftDay(date, -1))} aria-label="Previous day">
              <ChevronLeft size={17} />
            </button>
            {!today && <button className="today-button" type="button" onClick={() => setDate(isoToday())}>Today</button>}
            <button type="button" onClick={() => setDate(shiftDay(date, 1))} aria-label="Next day">
              <ChevronRight size={17} />
            </button>
          </div>
        </header>

        <MarkdownEditor key={day.date} day={day.date} initialValue={day.markdown} onChange={handleChange} />

        <footer className="page-foot">
          <span>{day.blockCount} blocks</span>
          <span className={pending ? 'saving' : 'saved'}>
            <CircleCheck size={13} /> {pending ? 'Saved locally' : 'Synced'}
          </span>
        </footer>

        {today && <TodayTasks today={date} />}
      </article>

      <aside className="context-panel">
        <div className="context-kicker"><Sparkles size={14} /> Thread is listening</div>
        <h2>Context from today</h2>
        <p className="context-copy">Links become living views without moving anything you wrote.</p>
        <div className="context-stats">
          <div><strong>{new Set(mentions.map((item) => item.threadId)).size}</strong><span>threads</span></div>
          <div><strong>{mentions.filter((item) => item.kind === 'task' && !item.checked).length}</strong><span>open tasks</span></div>
        </div>
        <div className="context-list">
          {Array.from(new Map(mentions.map((item) => [item.threadId, item])).values()).map((mention) => (
            <a key={mention.threadId} href={`#/thread/${mention.threadId}`}>
              <span className="thread-dot" />
              <span><b>{mention.title}</b><small>{mention.excerpt}</small></span>
              <Link2 size={14} />
            </a>
          ))}
          {mentions.length === 0 && <p className="empty-hint">Type <code>[[a name]]</code> to start a thread.</p>}
        </div>
      </aside>
    </div>
  )
}
