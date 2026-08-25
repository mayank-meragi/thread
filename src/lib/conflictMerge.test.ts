import { describe, expect, it } from 'vitest'
import { applyConflictResolutions, mergeMarkdown } from './conflictMerge'

describe('mergeMarkdown', () => {
  it('returns the shared content untouched when both sides agree', () => {
    const result = mergeMarkdown('- a\n- b', '- a\n- b', '- a\n- b')
    expect(result).toEqual({ markdown: '- a\n- b', conflicts: [] })
  })

  it('auto-merges edits to disjoint lines', () => {
    // A shared unchanged line between the two edits gives diff3 an anchor to
    // align on -- without one, two adjacent single-line edits with no
    // context between them are genuinely ambiguous to align (true of real
    // `git merge-file` too, not a quirk of this wrapper).
    const base = '- Tasks\n- middle\n- Notes'
    const local = '- Tasks (mine)\n- middle\n- Notes'
    const remote = '- Tasks\n- middle\n- Notes (theirs)'
    const result = mergeMarkdown(base, local, remote)
    expect(result.conflicts).toHaveLength(0)
    expect(result.markdown).toBe('- Tasks (mine)\n- middle\n- Notes (theirs)')
  })

  it('auto-merges when both sides make the identical change', () => {
    const result = mergeMarkdown('- a', '- a (same)', '- a (same)')
    expect(result.conflicts).toHaveLength(0)
    expect(result.markdown).toBe('- a (same)')
  })

  it('auto-merges independent additions at different positions', () => {
    // Insertions at the exact same position with nothing in the base to
    // anchor their relative order are a genuine ambiguity (same as two
    // simultaneous appends to the end of a file in real git) -- these are
    // at different positions, which diff3 can order unambiguously.
    const result = mergeMarkdown('- a\n- b', '- local addition\n- a\n- b', '- a\n- b\n- remote addition')
    expect(result.conflicts).toHaveLength(0)
    expect(result.markdown).toContain('local addition')
    expect(result.markdown).toContain('remote addition')
  })

  it('flags a real conflict when both sides change the same line differently', () => {
    const result = mergeMarkdown('- a', '- a (mine)', '- a (theirs)')
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toMatchObject({ local: '- a (mine)', remote: '- a (theirs)' })
  })

  it('flags an edit-vs-delete of the same line as a conflict', () => {
    const result = mergeMarkdown('- a\n- b', '- a (edited)\n- b', '- b')
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].local).toContain('a (edited)')
    expect(result.conflicts[0].remote).toBe('')
  })

  it('treats the whole document as one conflict when there is no known base', () => {
    const result = mergeMarkdown(null, '- mine', '- theirs')
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toMatchObject({ local: '- mine', remote: '- theirs' })
  })

  it('labels a conflict with the base text of the block in dispute', () => {
    const base = '- Tasks\n  - buy milk\n- Notes\n  - a'
    const local = '- Tasks\n  - buy milk\n- Notes\n  - a (mine)'
    const remote = '- Tasks\n  - buy milk\n- Notes\n  - a (theirs)'
    const result = mergeMarkdown(base, local, remote)
    expect(result.conflicts).toHaveLength(1)
    // Labeled from base's neutral text ("a"), not either side's edit.
    expect(result.conflicts[0].blockLabel).toBe('a')
  })
})

describe('applyConflictResolutions', () => {
  it('splices the chosen side into each marked conflict, leaving auto-merged lines untouched', () => {
    const merged = mergeMarkdown('- a\n- b\n- c', '- a (mine)\n- b\n- c (mine)', '- a (theirs)\n- b\n- c (theirs)')
    expect(merged.conflicts).toHaveLength(2)

    const resolved = applyConflictResolutions(merged.markdown, new Map([[0, 'local'], [1, 'remote']]))
    expect(resolved).toBe('- a (mine)\n- b\n- c (theirs)')
  })

  it('defaults an unresolved hunk to local', () => {
    const merged = mergeMarkdown('- a', '- a (mine)', '- a (theirs)')
    const resolved = applyConflictResolutions(merged.markdown, new Map())
    expect(resolved).toBe('- a (mine)')
  })
})
