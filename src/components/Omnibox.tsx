import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpenText, GitBranch, ListPlus, PanelRight, Search } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { createThread, db } from '../db'
import { formatDay } from '../lib/dates'
import { searchDays } from '../lib/search'

interface OmniboxProps {
  open: boolean
  initialMode: 'command' | 'search'
  onClose: () => void
  onTogglePanel?: () => void
}

interface OmniboxItem {
  id: string
  icon: React.ReactNode
  iconClassName?: string
  title: React.ReactNode
  subtitle: React.ReactNode
  onActivate: () => void
}

export function Omnibox({ open, initialMode, onClose, onTogglePanel }: OmniboxProps) {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [rawValue, setRawValue] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [caretBump, setCaretBump] = useState(0)

  const days = useLiveQuery(() => db.days.orderBy('date').reverse().toArray(), [], [])
  const threads = useLiveQuery(() => db.threads.orderBy('updatedAt').reverse().toArray(), [], [])

  // Reset the input whenever the omnibox opens (or is re-triggered into a
  // different mode while already open), seeded from initialMode. Adjusted
  // during render (not an effect) per React's "resetting state when a prop
  // changes" pattern.
  const [seenKey, setSeenKey] = useState<string | null>(null)
  const openKey = open ? initialMode : null
  if (openKey !== seenKey) {
    setSeenKey(openKey)
    if (openKey) {
      setRawValue(openKey === 'command' ? '>' : '')
      setHighlightedIndex(0)
    }
  }

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const input = inputRef.current
    input?.focus()
    input?.setSelectionRange(input.value.length, input.value.length)
    return () => { previousFocus?.focus() }
  }, [open])

  useEffect(() => {
    if (!caretBump) return
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }, [caretBump])

  const mode: 'command' | 'search' = rawValue.startsWith('>') ? 'command' : 'search'
  const query = mode === 'command' ? rawValue.slice(1) : rawValue
  const normalized = query.trim().toLocaleLowerCase()

  const close = () => {
    onClose()
  }

  const go = (path: string) => {
    navigate(path)
    close()
  }

  const openNewThread = async (title: string) => {
    const id = await createThread(title)
    go(`/thread/${id}`)
  }

  // Seed the input with a `>` command and park the caret at the end, so the
  // user can keep typing (e.g. after picking "New thread"). The caret move is
  // deferred to an effect so it runs after the controlled value has committed.
  const seedCommand = (value: string) => {
    setRawValue(value)
    setCaretBump((count) => count + 1)
  }

  // Command mode: `>new thread <name>` short-circuits the action list to a
  // single "create" item so a thread can be started without leaving the panel.
  const newThreadMatch = mode === 'command' ? query.match(/^new thread\s+(.+)$/i) : null

  const commandItems = useMemo<OmniboxItem[]>(() => {
    if (newThreadMatch) {
      const name = newThreadMatch[1].trim()
      return [{
        id: 'new-thread-create',
        icon: <GitBranch size={18} />,
        iconClassName: 'command-icon-thread',
        title: `Create thread "${name}"`,
        subtitle: 'Press ↵ to open it',
        onActivate: () => void openNewThread(name),
      }]
    }
    const actions: (OmniboxItem & { keywords: string })[] = [
      {
        id: 'capture',
        icon: <BookOpenText size={18} />,
        iconClassName: 'command-icon-note',
        title: 'Capture a note',
        subtitle: "Write in today's journal",
        keywords: 'capture note journal write',
        onActivate: () => go('/?capture=1'),
      },
      {
        id: 'task',
        icon: <ListPlus size={18} />,
        iconClassName: 'command-icon-task',
        title: 'Add a task',
        subtitle: "Create it in today's outline",
        keywords: 'add task todo',
        onActivate: () => go('/tasks?create=1'),
      },
      {
        id: 'new-thread',
        icon: <GitBranch size={18} />,
        iconClassName: 'command-icon-thread',
        title: 'New thread',
        subtitle: 'Start a fresh thread',
        keywords: 'new thread create branch',
        onActivate: () => seedCommand('>new thread '),
      },
      {
        id: 'search',
        icon: <Search size={18} />,
        title: 'Find anything',
        subtitle: 'Search notes and threads',
        keywords: 'find anything search',
        onActivate: () => go('/search'),
      },
      ...(onTogglePanel
        ? [{
            id: 'panel',
            icon: <PanelRight size={18} />,
            title: 'Toggle context panel',
            subtitle: 'Show or hide the right rail (⌘\\)',
            keywords: 'toggle context panel rail',
            onActivate: () => { onTogglePanel(); close() },
          }]
        : []),
    ]
    return actions.filter((action) => !normalized || action.keywords.includes(normalized))
  }, [normalized, onTogglePanel, newThreadMatch]) // eslint-disable-line react-hooks/exhaustive-deps

  const dayHits = useMemo(() => searchDays(days, normalized), [days, normalized])

  const searchItems = useMemo<OmniboxItem[]>(() => {
    if (!normalized) {
      return threads.map((thread) => ({
        id: `thread-${thread.id}`,
        icon: <span className="thread-dot" />,
        title: thread.title,
        subtitle: 'Recent thread',
        onActivate: () => go(`/thread/${thread.id}`),
      }))
    }
    const results: OmniboxItem[] = dayHits.map((hit) => ({
      id: `day-${hit.date}`,
      icon: <BookOpenText size={18} />,
      title: `${formatDay(hit.date).weekday}, ${formatDay(hit.date).full}`,
      subtitle: hit.matchLine,
      onActivate: () => go(`/?date=${hit.date}`),
    }))
    // Fallback: unless the query already names an existing thread, offer to
    // start one with that name.
    const name = query.trim()
    if (name && !threads.some((thread) => thread.normalizedTitle === normalized)) {
      results.push({
        id: 'create-thread',
        icon: <GitBranch size={18} />,
        iconClassName: 'command-icon-thread',
        title: `Open new thread "${name}"`,
        subtitle: 'Create a thread with this name',
        onActivate: () => void openNewThread(name),
      })
    }
    return results
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized, dayHits, threads])

  const items = mode === 'command' ? commandItems : searchItems

  // Re-highlight the first item whenever the query/mode changes the result
  // set (adjusted during render, same pattern as above).
  const [seenResultsKey, setSeenResultsKey] = useState<string | null>(null)
  const resultsKey = `${mode}:${normalized}`
  if (resultsKey !== seenResultsKey) {
    setSeenResultsKey(resultsKey)
    setHighlightedIndex(0)
  }

  if (!open) return null

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex((index) => Math.min(index + 1, items.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((index) => Math.max(index - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      items[highlightedIndex]?.onActivate()
    }
  }

  return (
    <div className="layer-backdrop layer-backdrop-center layer-backdrop-blur command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <section className="dialog command-sheet" role="dialog" aria-modal="true" aria-label="Omnibox">
        <label className="command-input">
          <Search size={18} />
          <input
            ref={inputRef}
            value={rawValue}
            onChange={(event) => setRawValue(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={mode === 'command' ? 'capture, task, search, panel…' : 'Type to search, or > for actions'}
            aria-label={mode === 'command' ? 'Run a command' : 'Search notes and threads'}
          />
        </label>

        <div className="command-actions">
          {mode === 'search' && (
            <div className="section-label"><span>{normalized ? 'Journal days' : 'Recent threads'}</span><small>{normalized ? dayHits.length : items.length}</small></div>
          )}
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={index === highlightedIndex ? 'command-item-active' : undefined}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => item.onActivate()}
            >
              <span className={`command-icon${item.iconClassName ? ` ${item.iconClassName}` : ''}`}>{item.icon}</span>
              <span><strong>{item.title}</strong><small>{item.subtitle}</small></span>
            </button>
          ))}
          {items.length === 0 && <p className="empty-hint">No matches for "{query}".</p>}
        </div>

        <footer><kbd>⌘⇧P</kbd><span>command</span><kbd>⌘⇧O</kbd><span>search</span><kbd>↑↓</kbd><span>navigate</span><kbd>↵</kbd><span>select</span></footer>
      </section>
    </div>
  )
}
