export type InspectorTarget = { kind: 'block' | 'task'; id: string } | null

export const INSPECTOR_TARGET_EVENT = 'thread:inspector-target-changed'

let current: InspectorTarget = null

export function getInspectorTarget(): InspectorTarget {
  return current
}

export function openBlockInspector(blockId: string): void {
  setTarget({ kind: 'block', id: blockId })
}

export function openTaskInspector(taskId: string): void {
  setTarget({ kind: 'task', id: taskId })
}

export function closeInspector(): void {
  setTarget(null)
}

function setTarget(next: InspectorTarget): void {
  current = next
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(INSPECTOR_TARGET_EVENT, { detail: next }))
  }
}
