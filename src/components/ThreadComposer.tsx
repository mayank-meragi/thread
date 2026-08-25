import { useCallback, useEffect } from 'react'
import { ChevronRight } from 'lucide-react'
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
    <details className="thread-composer projection-disclosure" open>
      <summary className="thread-composer-label">
        <span><ChevronRight size={15} /> Continue this thread</span>
        <small>thread notes</small>
      </summary>
      <div className="projection-disclosure-content full-bleed">
        <MarkdownEditor
          key={threadId}
          day={`thread:${threadId}`}
          initialValue={note.markdown}
          onChange={handleChange}
          ariaLabel={`${title} thread notes editor`}
          loadingLabel="Opening thread notes…"
        />
      </div>
    </details>
  )
}
