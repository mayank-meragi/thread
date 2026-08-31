import { useEffect, useRef, useState } from 'react'
import { renameThread } from '../db'

// Inline-editable thread heading. Commits on Enter/blur (same commit-on-blur
// idea as inspector/TaskDraft), reverts on Escape or an empty value.
export function EditableThreadTitle({ threadId, title }: { threadId: string; title: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const startEditing = () => {
    setDraft(title)
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    const clean = draft.trim()
    if (!clean || clean === title) return
    void renameThread(threadId, clean)
  }

  if (!editing) {
    return (
      <h1
        className="thread-title"
        tabIndex={0}
        role="button"
        title="Rename thread"
        onClick={startEditing}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'F2') {
            event.preventDefault()
            startEditing()
          }
        }}
      >
        {title}
      </h1>
    )
  }

  return (
    <input
      ref={inputRef}
      className="thread-title thread-title-input"
      value={draft}
      aria-label="Thread name"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          setEditing(false)
        }
      }}
    />
  )
}
