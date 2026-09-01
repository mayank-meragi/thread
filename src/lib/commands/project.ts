import { slugifyThread } from '../outline'
import type { PreparedCommand } from './types'

export interface ProjectedEntity {
  kind: 'thread' | 'template' | 'property'
  id: string
  label: string
}

// Predicts a command's output object *without executing it*, so a plan
// resolver can thread an earlier action's `$result` into a later action
// before anything is written. Derived purely from `prepared.input` /
// `prepared.resolved` / `prepared.preview` -- it never touches the database
// and adds no domain knowledge beyond mirroring each command's `execute`
// return shape (minus the write). Returns `undefined` when the output of a
// capability cannot be projected.
export function projectCommandOutput(prepared: PreparedCommand): unknown | undefined {
  const resolved = prepared.resolved as Record<string, unknown>
  const input = prepared.input as Record<string, unknown>
  const hasChanges = prepared.preview.changes.length > 0
  const thread = resolved.thread as { id: string; title: string } | undefined
  const existing = resolved.existing as { id: string } | undefined

  switch (prepared.capability) {
    case 'thread.create':
      return existing
        ? { thread: existing.id, created: false }
        : { thread: slugifyThread(String(input.title)), created: true }
    case 'template.create':
      return { thread: slugifyThread(String(input.title)), created: true }
    case 'thread.rename':
      return { thread: thread?.id, changed: thread?.title !== input.title }
    case 'thread.content.append':
    case 'thread.content.replace':
      return { thread: thread?.id, changed: resolved.before !== resolved.after }
    case 'template.enable':
    case 'template.disable':
    case 'template.apply':
    case 'property.assign':
    case 'property.set':
    case 'property.remove':
      return { thread: thread?.id, changed: hasChanges }
    case 'property.create':
      return existing
        ? { property: existing.id, created: false }
        : { property: String(input.name), created: true }
    case 'journal.takeNote': {
      const persona = resolved.persona as { id: string } | undefined
      return { persona: persona?.id, changed: true }
    }
    default:
      return undefined
  }
}
