import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSearchParams } from 'react-router-dom'
import { db, ensureDay, saveDay } from '../db'
import { daysBetween, formatDay, isoToday, shiftDay } from '../lib/dates'
import { getGitHubConfig, pullDay } from '../lib/github'
import { MarkdownEditor } from '../components/MarkdownEditor'
import { TodayTasks } from '../components/TodayTasks'
import { TodayWorkouts } from '../components/workouts/TodayWorkouts'
import { DatePicker } from '../components/DatePicker'

const INITIAL_DAYS = 14
const LOAD_BATCH = 14

export function TodayPage() {
  const [searchParams] = useSearchParams()
  const paramDate = searchParams.get('date')
  const paramBlock = searchParams.get('block')
  const captureRequested = searchParams.get('capture') === '1'
  const blockTargetDate = paramDate || isoToday()

  const [dates, setDates] = useState<string[]>(() => {
    const today = isoToday()
    const earliest = shiftDay(today, -(INITIAL_DAYS - 1))
    const initial = daysBetween(earliest, today)
    if (paramDate && paramDate < earliest && paramDate <= today) {
      return daysBetween(paramDate, today)
    }
    return initial
  })
  const [activeDate, setActiveDate] = useState(() => paramDate || isoToday())

  const sectionElsRef = useRef(new Map<string, HTMLElement>())
  const journalPageRef = useRef<HTMLElement>(null)
  const bottomSentinelRef = useRef<HTMLDivElement>(null)
  const loadingMoreRef = useRef(false)
  const jumpSettlingRef = useRef(false)
  const [pendingJump, setPendingJump] = useState<{ date: string; behavior: ScrollBehavior } | null>(() => ({
    date: paramDate || isoToday(),
    behavior: 'auto',
  }))

  const registerSection = useCallback((date: string, el: HTMLElement | null) => {
    if (el) sectionElsRef.current.set(date, el)
    else sectionElsRef.current.delete(date)
  }, [])

  // Always returns a new array reference, even when `clamped` was already
  // loaded -- jumpTo relies on `dates` changing by reference to retrigger the
  // scroll-effect below, since a jump to an already-loaded date wouldn't
  // otherwise touch state at all.
  const ensureDateLoaded = useCallback((target: string) => {
    const today = isoToday()
    const clamped = target > today ? today : target
    setDates((prev) => {
      if (prev.includes(clamped)) return [...prev]
      if (clamped < prev[0]) return [...daysBetween(clamped, shiftDay(prev[0], -1)), ...prev]
      if (clamped > prev[prev.length - 1]) return [...prev, ...daysBetween(shiftDay(prev[prev.length - 1], 1), clamped)]
      return [...prev]
    })
    return clamped
  }, [])

  const jumpTo = useCallback((target: string, behavior: ScrollBehavior = 'smooth') => {
    const clamped = ensureDateLoaded(target)
    setPendingJump({ date: clamped, behavior })
  }, [ensureDateLoaded])

  // Landing on the Today tab via a jump-to-source link (e.g. from the tasks
  // list) while it's already mounted for a different day. Both the date-load
  // and the pending-jump target are this component's own state, so both are
  // set here during render rather than in an effect -- avoids an extra
  // cascading render pass, and (unlike a ref) guarantees the layout effect
  // below sees the up-to-date target in the same commit that loads it.
  const [syncedParamDate, setSyncedParamDate] = useState(paramDate)
  if (paramDate && paramDate !== syncedParamDate) {
    setSyncedParamDate(paramDate)
    const clamped = ensureDateLoaded(paramDate)
    setPendingJump({ date: clamped, behavior: 'smooth' })
  }

  const activeDateRef = useRef(activeDate)
  useEffect(() => {
    activeDateRef.current = activeDate
  }, [activeDate])

  // The tab can sit open across midnight -- without this, "today" only ever
  // updates on a fresh mount (reload/navigation). Recheck on every point the
  // user returns to the tab, and only auto-follow to the new day if they were
  // already anchored on today (never yank them away from a day they're
  // deliberately reading).
  const lastKnownTodayRef = useRef(isoToday())
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState !== 'visible') return
      const now = isoToday()
      if (now === lastKnownTodayRef.current) return
      const wasOnToday = activeDateRef.current === lastKnownTodayRef.current
      lastKnownTodayRef.current = now
      if (wasOnToday) jumpTo(now, 'smooth')
      else ensureDateLoaded(now)
    }
    document.addEventListener('visibilitychange', recheck)
    window.addEventListener('focus', recheck)
    return () => {
      document.removeEventListener('visibilitychange', recheck)
      window.removeEventListener('focus', recheck)
    }
  }, [jumpTo, ensureDateLoaded])

  const sentinelIntersectingRef = useRef(false)
  const loadMoreBackward = useCallback(() => {
    if (loadingMoreRef.current) return
    loadingMoreRef.current = true
    setDates((prev) => {
      const earliest = prev[0]
      const additions = daysBetween(shiftDay(earliest, -LOAD_BATCH), shiftDay(earliest, -1))
      return [...additions, ...prev]
    })
  }, [])

  // Older days are appended below the currently-loaded range (the internal
  // array stays oldest-first; only the render order is reversed), so unlike
  // prepending, the browser keeps the scroll position stable on its own --
  // no compensation needed, just clear the guard once the new content is in.
  useEffect(() => {
    loadingMoreRef.current = false
  }, [dates])

  useEffect(() => {
    const el = bottomSentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        sentinelIntersectingRef.current = !!entries[0]?.isIntersecting
        // IntersectionObserver only calls back on a state change, not on
        // every frame it stays intersecting -- if the sentinel comes into
        // view while a jump-settle has it suppressed (see below) and never
        // leaves, this fires exactly once and then goes silent. The
        // settle-completion code checks sentinelIntersectingRef itself once
        // it's safe to load, so a stale "still intersecting" state isn't
        // lost, just deferred.
        if (!sentinelIntersectingRef.current || jumpSettlingRef.current) return
        loadMoreBackward()
      },
      { rootMargin: '0px 0px 1000px 0px', threshold: 0 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMoreBackward])

  useLayoutEffect(() => {
    if (!pendingJump) return
    const el = sectionElsRef.current.get(pendingJump.date)
    if (!el) return
    el.scrollIntoView({ behavior: pendingJump.behavior, block: 'start' })

    // Sections above the target can still be settling their layout (Dexie
    // reads, async editor mount), which shifts the target out from under the
    // scroll position right after the jump above. Re-snap on actual layout
    // changes -- not on a timer or every frame -- so this never fights a
    // scroll the user starts themselves. Meanwhile the bottom-sentinel loader
    // is suppressed: jumping near the end of the currently-loaded range can
    // put it back in view immediately, and letting it prepend more days
    // while this settle is still correcting the scroll position turns into
    // two corrections racing each other. pendingJump and jumpSettlingRef are
    // only cleared once the settle window completes (rather than right after
    // the call above) so StrictMode's dev-mode double-invoke of this effect
    // -- mount, clean up, mount again -- doesn't tear the correction down
    // after its first, immediately-cleaned-up pass and leave the second pass
    // with nothing to act on.
    if (!journalPageRef.current) return
    jumpSettlingRef.current = true
    let settled = false
    const resizeObserver = new ResizeObserver(() => {
      if (!settled) el.scrollIntoView({ behavior: 'auto', block: 'start' })
    })
    resizeObserver.observe(journalPageRef.current)
    const settleTimer = window.setTimeout(() => {
      settled = true
      resizeObserver.disconnect()
      jumpSettlingRef.current = false
      setPendingJump((current) => (current === pendingJump ? null : current))
      if (sentinelIntersectingRef.current) loadMoreBackward()
    }, 2500)
    return () => {
      settled = true
      resizeObserver.disconnect()
      window.clearTimeout(settleTimer)
    }
  }, [dates, pendingJump, loadMoreBackward])

  const handleSaveChange = useCallback((date: string, markdown: string) => {
    void saveDay(date, markdown)
  }, [])

  const today = isoToday()
  const label = formatDay(activeDate)
  const isViewingToday = activeDate === today

  return (
    <article className="journal-page" ref={journalPageRef}>
      <header className="day-toolbar">
        <div className="day-toolbar-label">{isViewingToday ? 'Today' : label.weekday}, {label.full}</div>
        <div className="day-actions" aria-label="Change day">
          <DatePicker selected={activeDate} onSelect={(date) => jumpTo(date, 'smooth')} />
          {!isViewingToday && (
            <button className="today-button" type="button" onClick={() => jumpTo(today, 'smooth')}>Today</button>
          )}
        </div>
      </header>

      <div className="day-sections">
        {[...dates].reverse().map((date) => (
          <DaySection
            key={date}
            date={date}
            isToday={date === today}
            registerSection={registerSection}
            onActive={setActiveDate}
            onChange={handleSaveChange}
            paramBlock={date === blockTargetDate ? paramBlock : null}
            captureRequested={captureRequested}
          />
        ))}
      </div>

      <div ref={bottomSentinelRef} className="day-load-sentinel" />
    </article>
  )
}

interface DaySectionProps {
  date: string
  isToday: boolean
  registerSection: (date: string, el: HTMLElement | null) => void
  onActive: (date: string) => void
  onChange: (date: string, markdown: string) => void
  paramBlock: string | null
  captureRequested: boolean
}

function DaySection({ date, isToday, registerSection, onActive, onChange, paramBlock, captureRequested }: DaySectionProps) {
  const day = useLiveQuery(() => db.days.get(date), [date])
  const editorWrapRef = useRef<HTMLDivElement>(null)
  const [hasBeenVisible, setHasBeenVisible] = useState(false)
  // Hold the editor back until the first remote pull for this day has settled,
  // so it opens on already-reconciled content instead of racing the pull and
  // producing a sync conflict if the user types against stale local content.
  // Starts true when sync is off -- nothing to wait for.
  const [remoteHydrated, setRemoteHydrated] = useState(() => !getGitHubConfig())

  useEffect(() => {
    void ensureDay(date)
  }, [date])

  useEffect(() => {
    if (remoteHydrated || !hasBeenVisible) return
    let done = false
    const finish = () => {
      if (done) return
      done = true
      setRemoteHydrated(true)
    }
    // Never let a slow or hanging request block editing outright; pullDay
    // already swallows transient failures (and no-ops instantly when GitHub
    // isn't connected), so this timer only covers a genuinely stuck round-trip.
    // A pull that lands afterwards is absorbed by MarkdownEditor's own
    // external-update guard.
    const timer = window.setTimeout(finish, 2500)
    void pullDay(date).finally(() => {
      window.clearTimeout(timer)
      finish()
    })
    return () => window.clearTimeout(timer)
  }, [hasBeenVisible, date, remoteHydrated])

  const sectionRefEl = useRef<HTMLElement | null>(null)
  const combinedRef = useCallback((el: HTMLElement | null) => {
    sectionRefEl.current = el
    registerSection(date, el)
  }, [date, registerSection])

  useEffect(() => {
    const el = sectionRefEl.current
    if (!el) return
    const visibility = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setHasBeenVisible(true)
      },
      { rootMargin: '800px 0px' },
    )
    visibility.observe(el)
    const active = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onActive(date)
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: 0 },
    )
    active.observe(el)
    return () => {
      visibility.disconnect()
      active.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  const jumpToBlock = useCallback(() => {
    if (!paramBlock || !editorWrapRef.current) return
    const target = editorWrapRef.current.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(paramBlock)}"]`)
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target.classList.add('jump-highlight')
    window.setTimeout(() => target.classList.remove('jump-highlight'), 1600)
  }, [paramBlock])

  useEffect(() => {
    jumpToBlock()
  }, [jumpToBlock])

  const handleChange = useCallback((markdown: string) => onChange(date, markdown), [date, onChange])

  const label = useMemo(() => formatDay(date), [date])

  if (!day || day.date !== date || !remoteHydrated) {
    return <section ref={combinedRef} className="day-section day-section-loading" data-date={date}>Opening…</section>
  }

  return (
    <section ref={combinedRef} className="day-section" data-date={date}>
      <header className="day-section-heading">
        <div className="eyebrow">{isToday ? 'Today' : label.weekday}</div>
        <h2>{label.weekday}, <span>{label.full}</span></h2>
      </header>

      <div ref={editorWrapRef}>
        <MarkdownEditor key={date} day={date} initialValue={day.markdown} onChange={handleChange} onReady={jumpToBlock} autoFocus={isToday && captureRequested} />
      </div>

      {isToday && <TodayWorkouts today={date} />}
      {isToday && <TodayTasks today={date} />}
    </section>
  )
}
