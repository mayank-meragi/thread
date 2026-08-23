import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { isoToday } from '../lib/dates'
import { getGitHubConfig, pullDay, syncPending } from '../lib/github'

export function useGitHubSync() {
  const pending = useLiveQuery(() => db.outbox.count(), [], 0)
  const conflicts = useLiveQuery(() => db.conflicts.filter((conflict) => !conflict.resolvedAt).count(), [], 0)
  const [connected, setConnected] = useState(() => Boolean(getGitHubConfig()))
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runSync = useCallback(() => {
    if (!getGitHubConfig()) return
    setSyncing(true)
    void syncPending()
      .then(() => setError(null))
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))
      .finally(() => setSyncing(false))
  }, [])

  useEffect(() => {
    const refresh = () => setConnected(Boolean(getGitHubConfig()))
    window.addEventListener('thread:github-config', refresh)
    return () => window.removeEventListener('thread:github-config', refresh)
  }, [])

  // Resolving a conflict in Settings doesn't go through this component's own
  // sync cycle, so a stale "Sync error" badge (from the sync attempt that
  // originally hit the conflict) would otherwise linger until some unrelated
  // future edit happened to trigger another sync. Clear it specifically when
  // the open-conflict count drops -- not just whenever it's zero, since that
  // would also mask a genuine unrelated error (e.g. auth) that has nothing to
  // do with conflicts.
  const previousConflicts = useRef(conflicts)
  useEffect(() => {
    if (conflicts < previousConflicts.current) setError(null)
    previousConflicts.current = conflicts
  }, [conflicts])

  useEffect(() => {
    if (!connected) return
    let timer: number | null = null
    // Debounced off the last local write, not off the outbox's item *count*.
    // A day's outbox entry is upserted under one fixed key, so its count
    // doesn't change across a typing burst -- keying the debounce to a value
    // that stays constant while the user keeps typing meant the timer never
    // actually reset, and fired mid-sentence rather than after the user
    // stopped.
    const scheduleSync = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(runSync, 2200)
    }
    // Catch up on anything already queued -- e.g. left over from a previous
    // session, or queued while offline -- instead of waiting for a new edit.
    void db.outbox.count().then((count) => { if (count > 0) scheduleSync() })
    window.addEventListener('thread:local-write', scheduleSync)
    return () => {
      window.removeEventListener('thread:local-write', scheduleSync)
      if (timer) window.clearTimeout(timer)
    }
  }, [connected, runSync])

  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden' && connected) {
        void syncPending()
          .then(() => setError(null))
          .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))
      }
    }
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('online', flush)
    return () => {
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('online', flush)
    }
  }, [connected])

  // Sync only ever pushed local changes -- it never checked whether another
  // device had pushed something newer for a day this browser already has.
  // "Up to date" meant only "nothing local is queued to push," which said
  // nothing about agreement with the remote. Keep Today's file fresh at
  // well-defined, low-risk moments only: once on connect, and whenever the
  // tab regains focus or the network comes back. Those are points where the
  // user has just returned to the tab and is very unlikely to be mid-
  // keystroke. A blind periodic timer was tried and removed: it fires at a
  // moment with no relation to what the user is doing, so it could (and did)
  // land in the middle of an active typing burst. MarkdownEditor's own guard
  // against applying an external update while there's unsaved local input is
  // the real safety net either way -- these triggers just decide when it's
  // worth asking.
  useEffect(() => {
    if (!connected) return
    const pullToday = () => void pullDay(isoToday())
    pullToday()
    const onVisible = () => {
      if (document.visibilityState === 'visible') pullToday()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', pullToday)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', pullToday)
    }
  }, [connected])

  return { connected, syncing, pending, conflicts, error, runSync }
}
