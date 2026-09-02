import { useSyncExternalStore } from 'react'
import type { PlanPreview } from './types'

// Capabilities the user chose "Always allow" for. A future proposal whose every
// step is a plain `write` on a trusted capability is confirmed automatically --
// see `isPlanTrusted` and the auto-approve path in ThreadScriptProposal.
const STORAGE_KEY = 'thread.trusted-capabilities'
const CHANGE_EVENT = 'thread:trusted-capabilities'
const EMPTY: readonly string[] = []

function read(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

let cache: string[] = read()

function write(next: string[]): void {
  cache = [...new Set(next)].sort()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function getTrustedCapabilities(): string[] {
  return read()
}

export function trustCapabilities(names: readonly string[]): void {
  if (names.length === 0) return
  write([...read(), ...names])
}

export function revokeCapability(name: string): void {
  write(read().filter((entry) => entry !== name))
}

/**
 * True when this plan can skip the approval gate: it does something, every step
 * is a plain `write` (never `destructive`/`external`), and every capability it
 * touches has been trusted.
 */
export function isPlanTrusted(preview: PlanPreview): boolean {
  if (preview.steps.length === 0 || preview.risk !== 'write') return false
  const trusted = new Set(read())
  return preview.steps.every((step) => step.risk === 'write' && trusted.has(step.capability))
}

export function useTrustedCapabilities(): string[] {
  return useSyncExternalStore(
    (onChange) => {
      const refresh = () => {
        cache = read()
        onChange()
      }
      window.addEventListener(CHANGE_EVENT, refresh)
      window.addEventListener('storage', refresh)
      return () => {
        window.removeEventListener(CHANGE_EVENT, refresh)
        window.removeEventListener('storage', refresh)
      }
    },
    () => cache,
    () => EMPTY as string[],
  )
}
