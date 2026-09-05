import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { getGitHubConfig, runGitHubSyncCycle, SYNC_STATE_EVENT, type GitHubSyncProgress } from '../lib/github'

const VISIBLE_POLL_MS = 5000

export function useGitHubSync() {
  const pending = useLiveQuery(() => db.outbox.count(), [], 0)
  const conflicts = useLiveQuery(() => db.conflicts.filter((conflict) => !conflict.resolvedAt).count(), [], 0)
  const [connected, setConnected] = useState(() => Boolean(getGitHubConfig()))
  const [progress, setProgress] = useState<GitHubSyncProgress>({ phase: 'idle' })
  const [error, setError] = useState<string | null>(null)

  const runSync = useCallback((forceFull = false) => {
    if (!getGitHubConfig()) return Promise.resolve()
    return runGitHubSyncCycle({ forceFull })
      .then(() => setError(null))
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))
  }, [])

  useEffect(() => {
    const refresh = () => setConnected(Boolean(getGitHubConfig()))
    window.addEventListener('thread:github-config', refresh)
    return () => window.removeEventListener('thread:github-config', refresh)
  }, [])

  useEffect(() => {
    const receiveProgress = (event: Event) => setProgress((event as CustomEvent<GitHubSyncProgress>).detail)
    window.addEventListener(SYNC_STATE_EVENT, receiveProgress)
    return () => window.removeEventListener(SYNC_STATE_EVENT, receiveProgress)
  }, [])

  const previousConflicts = useRef(conflicts)
  useEffect(() => {
    if (conflicts < previousConflicts.current) setError(null)
    previousConflicts.current = conflicts
  }, [conflicts])

  useEffect(() => {
    if (!connected) return
    let timer: number | null = null
    const scheduleSync = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => { void runSync() }, 2200)
    }
    void db.outbox.count().then((count) => { if (count > 0) scheduleSync() })
    window.addEventListener('thread:local-write', scheduleSync)
    return () => {
      window.removeEventListener('thread:local-write', scheduleSync)
      if (timer) window.clearTimeout(timer)
    }
  }, [connected, runSync])

  useEffect(() => {
    if (!connected) return
    const isVisibleAndOnline = () => document.visibilityState === 'visible' && navigator.onLine !== false
    const catchUp = () => { if (isVisibleAndOnline()) void runSync() }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') catchUp()
      else void runSync()
    }
    catchUp()
    const interval = window.setInterval(catchUp, VISIBLE_POLL_MS)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', catchUp)
    window.addEventListener('pageshow', catchUp)
    window.addEventListener('online', catchUp)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', catchUp)
      window.removeEventListener('pageshow', catchUp)
      window.removeEventListener('online', catchUp)
    }
  }, [connected, runSync])

  const syncing = progress.phase === 'checking' || progress.phase === 'catching-up'
  return { connected, syncing, pending, conflicts, error, progress, runSync }
}
