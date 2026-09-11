import { useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { Button } from '../ui'

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * A countdown for the active cook step's duration. Requests a screen wake
 * lock while running, best-effort. Pass `key={stepId}` from the caller so a
 * new step's duration resets the timer via remount instead of an effect.
 */
export function CookTimer({ seconds }: { seconds: number }) {
  const [remaining, setRemaining] = useState(seconds)
  const [running, setRunning] = useState(false)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (!running) return
    const interval = window.setInterval(() => {
      setRemaining((current) => {
        if (current <= 1) {
          setRunning(false)
          return 0
        }
        return current - 1
      })
    }, 1000)
    return () => window.clearInterval(interval)
  }, [running])

  useEffect(() => {
    if (!running) {
      void wakeLockRef.current?.release().catch(() => undefined)
      wakeLockRef.current = null
      return
    }
    if (!('wakeLock' in navigator)) return
    let cancelled = false
    void navigator.wakeLock.request('screen').then((sentinel) => {
      if (cancelled) void sentinel.release().catch(() => undefined)
      else wakeLockRef.current = sentinel
    }).catch(() => undefined)
    return () => {
      cancelled = true
      void wakeLockRef.current?.release().catch(() => undefined)
      wakeLockRef.current = null
    }
  }, [running])

  return (
    <div className="cook-timer" role="timer">
      <span className="cook-timer-clock">{formatClock(remaining)}</span>
      <div className="cook-timer-controls">
        <Button variant="ghost" size="sm" iconOnly onClick={() => setRunning((value) => !value)} disabled={remaining === 0} aria-label={running ? 'Pause timer' : 'Start timer'}>
          {running ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
        </Button>
        <Button variant="ghost" size="sm" iconOnly onClick={() => { setRunning(false); setRemaining(seconds) }} aria-label="Reset timer">
          <RotateCcw size={14} aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
