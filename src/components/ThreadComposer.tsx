import { useCallback, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, ensureThreadNote, saveThreadNote } from '../db'
import { MarkdownEditor } from './MarkdownEditor'

export function ThreadComposer({ threadId, title }: { threadId: string; title: string }) {
  const note = useLiveQuery(() => db.threadNotes.get(threadId), [threadId])

  useEffect(() => {
    void ensureThreadNote(threadId)
  }, [threadId])

  const handleChange = useCallback((markdown: string) => {
    void saveThreadNote(threadId, markdown)
  }, [threadId])

  if (!note) return <div className="thread-composer-loading">Opening thread notes…</div>

  return (
    <section className="thread-composer" aria-label={`Add notes to ${title}`}>
      <div className="thread-composer-label">
        <span>Continue this thread</span>
        <small>thread notes</small>
      </div>
      <MarkdownEditor
        key={threadId}
        day={`thread:${threadId}`}
        initialValue={note.markdown}
        onChange={handleChange}
        ariaLabel={`${title} thread notes editor`}
        loadingLabel="Opening thread notes…"
      />
    </section>
  )
}
