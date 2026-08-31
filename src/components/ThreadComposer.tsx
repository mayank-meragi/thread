import { useCallback, useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, ensureThreadNote, saveThreadNote } from '../db'
import { getGitHubConfig, pullThreadNote } from '../lib/github'
import { parseThreadDocument } from '../lib/threadDocument'
import { MarkdownEditor } from './MarkdownEditor'

export function ThreadComposer({ threadId, title }: { threadId: string; title: string }) {
  const note = useLiveQuery(() => db.threadNotes.get(threadId), [threadId])
  // Hold the editor back until the first remote pull for this note has settled,
  // so it opens on already-reconciled content instead of racing the pull and
  // producing a sync conflict if the user types against stale local content.
  // Starts true when sync is off -- nothing to wait for. This component is
  // keyed by threadId upstream, so the initializer re-runs per thread.
  const [remoteHydrated, setRemoteHydrated] = useState(() => !getGitHubConfig())

  useEffect(() => {
    void ensureThreadNote(threadId)
  }, [threadId])

  useEffect(() => {
    if (remoteHydrated) return
    let done = false
    const finish = () => {
      if (done) return
      done = true
      setRemoteHydrated(true)
    }
    // Never let a slow or hanging request block editing outright; pullThreadNote
    // already swallows transient failures (and no-ops instantly when GitHub
    // isn't connected), so this timer only covers a genuinely stuck round-trip.
    // A pull that lands afterwards is absorbed by MarkdownEditor's own
    // external-update guard.
    const timer = window.setTimeout(finish, 2500)
    void pullThreadNote(threadId).finally(() => {
      window.clearTimeout(timer)
      finish()
    })
    return () => window.clearTimeout(timer)
  }, [threadId, remoteHydrated])

  // Keep the note fresh when returning to the tab or regaining the network --
  // low-risk moments where the user is unlikely to be mid-keystroke. Mirrors
  // the day pull triggers in useGitHubSync; MarkdownEditor's external-update
  // guard is the safety net against clobbering active typing either way.
  useEffect(() => {
    if (!getGitHubConfig()) return
    const pull = () => void pullThreadNote(threadId)
    const onVisible = () => {
      if (document.visibilityState === 'visible') pull()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', pull)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', pull)
    }
  }, [threadId])

  const handleChange = useCallback((markdown: string) => {
    void saveThreadNote(threadId, markdown)
  }, [threadId])

  if (!note || !remoteHydrated) return <div className="thread-composer-loading">Opening thread notes…</div>

  // The editor never sees the `<!-- thread-metadata -->` envelope -- it edits
  // prose only. saveThreadNote re-attaches the current metadata on the way back.
  const body = parseThreadDocument(note.markdown).markdown

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
          initialValue={body}
          onChange={handleChange}
          ariaLabel={`${title} thread notes editor`}
          loadingLabel="Opening thread notes…"
        />
      </div>
    </details>
  )
}
