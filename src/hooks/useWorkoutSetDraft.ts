import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropertyValue } from '../db'
import { updateSet } from '../lib/workouts/mutations'

export interface SetDraft {
  load: number | null
  loadUnit: string | null
  reps: number | null
  rpe: number | null
  durationSeconds: number | null
  distance: number | null
  distanceUnit: string | null
}

function readNumber(properties: Map<string, PropertyValue>, id: string): number | null {
  const value = properties.get(id)
  return typeof value === 'number' ? value : null
}

function readText(properties: Map<string, PropertyValue>, id: string): string | null {
  const value = properties.get(id)
  return typeof value === 'string' && value ? value : null
}

function seed(properties: Map<string, PropertyValue>): SetDraft {
  return {
    load: readNumber(properties, 'set-load'),
    loadUnit: readText(properties, 'set-load-unit'),
    reps: readNumber(properties, 'set-reps'),
    rpe: readNumber(properties, 'set-rpe'),
    durationSeconds: readNumber(properties, 'set-duration-seconds'),
    distance: readNumber(properties, 'set-distance'),
    distanceUnit: readText(properties, 'set-distance-unit'),
  }
}

/** A load/distance value implies a unit; default it so live saves validate. */
export function withDefaultedUnits(draft: SetDraft): SetDraft {
  return {
    ...draft,
    loadUnit: draft.load !== null && !draft.loadUnit ? 'kg' : draft.loadUnit,
    distanceUnit: draft.distance !== null && !draft.distanceUnit ? 'm' : draft.distanceUnit,
  }
}

/**
 * Local editing buffer for one set, seeded once from its stored properties (the
 * caller keys the owning component by set id, so a fresh mount == a fresh set).
 * Field changes autosave ~500ms later; `flush()` writes immediately and the
 * panel also flushes any pending edit on unmount.
 */
export function useWorkoutSetDraft(setTaskId: string, properties: Map<string, PropertyValue>) {
  const [draft, setDraft] = useState<SetDraft>(() => seed(properties))
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const latest = useRef({ draft, dirty, setTaskId })
  useEffect(() => {
    latest.current = { draft, dirty, setTaskId }
  })

  const save = useCallback(async (value: SetDraft) => {
    try {
      await updateSet(latest.current.setTaskId, { ...withDefaultedUnits(value) })
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [])

  useEffect(() => {
    if (!dirty) return
    const handle = setTimeout(() => {
      setDirty(false)
      void save(draft)
    }, 500)
    return () => clearTimeout(handle)
  }, [dirty, draft, save])

  useEffect(() => () => {
    if (latest.current.dirty) void save(latest.current.draft)
  }, [save])

  const setField = useCallback(<K extends keyof SetDraft>(key: K, value: SetDraft[K]) => {
    setDraft((current) => withDefaultedUnits({ ...current, [key]: value }))
    setDirty(true)
  }, [])

  const flush = useCallback(async () => {
    if (!latest.current.dirty) return
    setDirty(false)
    await save(latest.current.draft)
  }, [save])

  return { draft, setField, flush, error }
}
