import { diff3Merge } from 'node-diff3'
import { parseOutline } from './outline'

export interface MergeConflict {
  index: number
  blockLabel: string
  local: string
  remote: string
}

export interface MergeResult {
  markdown: string
  conflicts: MergeConflict[]
}

export const LOCAL_MARKER = '<<<<<<< local'
export const SEPARATOR_MARKER = '======='
export const REMOTE_MARKER = '>>>>>>> remote'

function labelForLine(blocks: ReturnType<typeof parseOutline>['blocks'], line: number): string {
  let label = 'the top of the note'
  for (const block of blocks) {
    if (block.order > line) break
    if (block.plainText) label = block.plainText
  }
  return label.length > 60 ? `${label.slice(0, 60)}…` : label
}

// A three-way merge (git's diff3 algorithm, via node-diff3) between the last
// content both sides agreed on (`base`) and the two versions that diverged
// from it. Any line only one side touched -- or that both sides changed to
// the same thing -- merges automatically. Only lines both sides changed
// *differently* come back as a conflict, so callers only need to interrupt
// the user for those, never for the whole document.
export function mergeMarkdown(base: string | null, local: string, remote: string): MergeResult {
  if (local === remote) return { markdown: local, conflicts: [] }

  if (base === null) {
    // No known common ancestor (e.g. a pre-migration record) -- there's
    // nothing to diff against, so the whole document is the conflict. This
    // matches the previous whole-file behavior rather than guessing. Still
    // wrapped in markers (rather than just returning `local`) so
    // applyConflictResolutions can splice in whichever side gets chosen.
    return {
      markdown: [LOCAL_MARKER, local, SEPARATOR_MARKER, remote, REMOTE_MARKER].join('\n'),
      conflicts: [{ index: 0, blockLabel: 'the whole note', local, remote }],
    }
  }

  const regions = diff3Merge(local, base, remote, { stringSeparator: '\n' })
  const baseBlocks = parseOutline(base, '').blocks
  const lines: string[] = []
  const conflicts: MergeConflict[] = []

  for (const region of regions) {
    if (region.ok) {
      lines.push(...region.ok)
      continue
    }
    if (region.conflict) {
      const { a, b, oIndex } = region.conflict
      const localText = a.join('\n')
      const remoteText = b.join('\n')
      conflicts.push({
        index: conflicts.length,
        // Labeled from the base's own text at this position (neutral,
        // unaffected by either side's edit) rather than the merged output's
        // line offset -- insertions/deletions elsewhere can shift that
        // offset away from where the conflict actually sits in the base.
        blockLabel: labelForLine(baseBlocks, oIndex),
        local: localText,
        remote: remoteText,
      })
      lines.push(LOCAL_MARKER, ...a, SEPARATOR_MARKER, ...b, REMOTE_MARKER)
    }
  }

  return { markdown: lines.join('\n'), conflicts }
}

// Splices resolved choices into a merge draft produced by mergeMarkdown,
// replacing each conflict's marker block with whichever side was chosen.
export function applyConflictResolutions(
  mergedMarkdown: string,
  choices: Map<number, 'local' | 'remote'>,
): string {
  const lines = mergedMarkdown.split('\n')
  const result: string[] = []
  let conflictIndex = -1
  let mode: 'copy' | 'local' | 'remote' | 'skip' = 'copy'

  for (const line of lines) {
    if (line === LOCAL_MARKER) {
      conflictIndex += 1
      const choice = choices.get(conflictIndex) ?? 'local'
      mode = choice === 'local' ? 'local' : 'skip'
      continue
    }
    if (line === SEPARATOR_MARKER && mode !== 'copy') {
      const choice = choices.get(conflictIndex) ?? 'local'
      mode = choice === 'remote' ? 'remote' : 'skip'
      continue
    }
    if (line === REMOTE_MARKER) {
      mode = 'copy'
      continue
    }
    if (mode === 'copy' || mode === 'local' || mode === 'remote') result.push(line)
  }

  return result.join('\n')
}
