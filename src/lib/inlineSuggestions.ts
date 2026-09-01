import { shift } from '@floating-ui/dom'
import { linkSchema } from '@milkdown/preset-commonmark'
import { SlashProvider } from '@milkdown/plugin-slash'
import { Plugin, TextSelection } from '@milkdown/prose/state'
import type { EditorState } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'
import { $prose } from '@milkdown/utils'
import { slugifyThread } from './outline'
import {
  findSuggestionTrigger,
  isInsertCommand,
  rankSlashCommands,
  rankTagSuggestions,
  rankThreadSuggestions,
  type BlockConversionKind,
  type SlashCommand,
  type SuggestionTrigger,
  type TagSuggestion,
  type ThreadSuggestion,
} from './suggestions'
import type { InsertCommandId } from './blockKinds/definitions'
import { WIKI_TITLE } from './wikilinks'
import { slugifyTag } from './hashtags'
import { TAG_HREF_PREFIX, TAG_TITLE } from './taglinks'

interface InlineSuggestionOptions {
  getThreads: () => Promise<ThreadSuggestion[]>
  getTags: () => Promise<TagSuggestion[]>
  onMutation: () => void
  setBlockKind: (view: EditorView, kind: BlockConversionKind, replaceRange?: { from: number; to: number }) => void
  insertBlockCommand: (view: EditorView, id: InsertCommandId, replaceRange: { from: number; to: number }) => void
}

type ActiveTrigger = SuggestionTrigger & {
  from: number
  to: number
}

// Escape dismisses a trigger occurrence for as long as the cursor stays inside
// it — including further edits (typing or Backspace) — and only re-arms once
// a genuinely new trigger starts (a different `from` position). Keying on
// `kind:from` rather than the full kind:from:to:query tuple is what makes
// this "sticky": from is the one part of the tuple that doesn't change as the
// query grows or shrinks within the same occurrence.
export function isTriggerDismissed(dismissedKey: string, trigger: { kind: string; from: number }): boolean {
  return dismissedKey === `${trigger.kind}:${trigger.from}`
}

type MenuEntry =
  | { type: 'thread'; id: string; title: string }
  | { type: 'create-thread'; id: string; title: string }
  | { type: 'tag'; id: string; name: string; color?: string; propertyCount: number }
  | { type: 'create-tag'; id: string; name: string }
  | { type: 'command'; command: SlashCommand }

function triggerFromState(state: EditorState): ActiveTrigger | null {
  const { selection } = state
  if (!(selection instanceof TextSelection) || !selection.empty) return null
  const $cursor = state.doc.resolve(selection.from)
  if (!$cursor.parent.isTextblock) return null
  const before = $cursor.parent.textBetween(0, $cursor.parentOffset, undefined, '\ufffc')
  const after = $cursor.parent.textBetween($cursor.parentOffset, $cursor.parent.content.size, undefined, '\ufffc')
  const trigger = findSuggestionTrigger(before, after)
  if (!trigger) return null
  const paragraphStart = $cursor.start()
  return {
    ...trigger,
    from: paragraphStart + trigger.fromOffset,
    to: paragraphStart + trigger.toOffset,
  }
}

export function inlineSuggestionsPlugin(options: InlineSuggestionOptions) {
  return $prose((ctx) => {
    const linkType = linkSchema.type(ctx)
    let controller: ReturnType<typeof createMenuController> | null = null

    return new Plugin({
      view(view) {
        controller = createMenuController(view, options, linkType)
        return {
          update: () => controller?.sync(),
          destroy: () => {
            controller?.destroy()
            controller = null
          },
        }
      },
      props: {
        handleKeyDown(_view, event) {
          return controller?.handleKeyDown(event) ?? false
        },
      },
    })
  })
}

function createMenuController(
  view: EditorView,
  options: InlineSuggestionOptions,
  linkType: ReturnType<typeof linkSchema.type>,
) {
  const menu = document.createElement('div')
  menu.className = 'menu-panel editor-suggestion-menu'
  menu.id = `thread-suggestions-${Math.random().toString(36).slice(2)}`
  menu.setAttribute('role', 'listbox')
  menu.hidden = true
  document.body.append(menu)

  const status = document.createElement('div')
  status.className = 'sr-only'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')

  // Positioning only: SlashProvider never drives visibility itself (its own
  // trigger-char shouldShow check is too coarse for our multi-character
  // queries) -- `menu.hidden` remains the single source of truth for whether
  // the menu is shown, same as before this was introduced. See the
  // `shouldShow` option below for why it still needs to track `menu.hidden`.
  const slashProvider = new SlashProvider({
    content: menu,
    // menu is `position: fixed` and already appended to document.body below;
    // without an explicit root, SlashProvider reparents `content` into
    // view.dom.parentElement on its first update, which would move it out of
    // body and could change its fixed-position containing block.
    root: document.body,
    debounce: 0,
    offset: 7,
    // `menu.hidden` is the single source of truth for visibility (set by
    // render()/dismiss() before this ever runs); this only gates whether
    // SlashProvider computes a position at all, not whether it's shown --
    // shouldShow: () => false would skip its internal computePosition() call
    // entirely, leaving left/top unset even though we still need it computed.
    shouldShow: () => !menu.hidden,
    // flip() and offset() are already applied internally by SlashProvider;
    // shift() adds the horizontal/vertical viewport clamping the old manual
    // positionMenu() did (10px gutter, matching padding here).
    middleware: [shift({ padding: 10 })],
    // matches .editor-suggestion-menu's `position: fixed` -- floating-ui's
    // default 'absolute' strategy would compute coordinates that don't
    // account for fixed positioning correctly once the page/editor scrolls.
    floatingUIOptions: { strategy: 'fixed' },
  })

  let activeTrigger: ActiveTrigger | null = null
  let entries: MenuEntry[] = []
  let activeIndex = 0
  let threads: ThreadSuggestion[] = []
  let threadsReady = false
  let tags: TagSuggestion[] = []
  let tagsReady = false
  let requestId = 0
  let lastTriggerKey = ''
  let dismissedTriggerKey = ''
  let previousKind: ActiveTrigger['kind'] | null = null

  const triggerKey = (trigger: ActiveTrigger) => `${trigger.kind}:${trigger.from}:${trigger.to}:${trigger.query}`
  const dismissKey = (trigger: ActiveTrigger) => `${trigger.kind}:${trigger.from}`

  const makeEntries = (trigger: ActiveTrigger): MenuEntry[] => {
    if (trigger.kind === 'slash') {
      return rankSlashCommands(trigger.query).map((command) => ({ type: 'command', command }))
    }

    if (trigger.kind === 'hashtag') {
      if (!tagsReady) return []
      const ranked = rankTagSuggestions(tags, trigger.query)
      const next: MenuEntry[] = ranked.map((tag) => ({ type: 'tag', ...tag }))
      const name = trigger.query.trim()
      const hasExact = ranked.some((tag) => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase())
      const id = slugifyTag(name)
      if (name && id && !hasExact) next.push({ type: 'create-tag', id, name })
      return next
    }

    if (!threadsReady) return []
    const ranked = rankThreadSuggestions(threads, trigger.query)
    const next: MenuEntry[] = ranked.map((thread) => ({ type: 'thread', id: thread.id, title: thread.title }))
    const title = trigger.query.trim()
    const hasExact = ranked.some((thread) => thread.title.toLocaleLowerCase() === title.toLocaleLowerCase())
    const id = slugifyThread(title)
    if (title && id && !hasExact) next.push({ type: 'create-thread', id, title })
    return next
  }

  const positionMenu = () => {
    if (!activeTrigger || menu.hidden) return
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth
    menu.style.width = `${Math.min(310, viewportWidth - 20)}px`
    slashProvider.update(view)
  }

  const accept = (entry: MenuEntry, appendSpace = false) => {
    const trigger = activeTrigger
    if (!trigger) return
    options.onMutation()

    if (entry.type === 'command') {
      if (isInsertCommand(entry.command)) {
        options.insertBlockCommand(view, entry.command.id, { from: trigger.from, to: trigger.to })
      } else {
        options.setBlockKind(view, entry.command.id, { from: trigger.from, to: trigger.to })
      }
    } else if (entry.type === 'thread' || entry.type === 'create-thread') {
      const mark = linkType.create({ href: `#/thread/${entry.id}`, title: WIKI_TITLE })
      const transaction = view.state.tr.replaceWith(
        trigger.from,
        trigger.to,
        view.state.schema.text(entry.title, [mark]),
      )
      transaction.setSelection(TextSelection.create(transaction.doc, trigger.from + entry.title.length))
      transaction.setStoredMarks([])
      view.dispatch(transaction)
    } else {
      const name = entry.name
      const mark = linkType.create({ href: `${TAG_HREF_PREFIX}${entry.id}`, title: TAG_TITLE })
      const transaction = view.state.tr.replaceWith(
        trigger.from,
        trigger.to,
        view.state.schema.text(name, [mark]),
      )
      const end = trigger.from + name.length
      transaction.setSelection(TextSelection.create(transaction.doc, end))
      transaction.setStoredMarks([])
      if (appendSpace) transaction.insertText(' ', end)
      view.dispatch(transaction)
    }

    activeTrigger = null
    menu.hidden = true
    view.focus()
  }

  const optionId = (index: number) => `${menu.id}-option-${index}`

  const render = () => {
    menu.replaceChildren()
    if (!activeTrigger) {
      menu.hidden = true
      menu.removeAttribute('aria-activedescendant')
      return
    }

    entries = makeEntries(activeTrigger)
    activeIndex = Math.min(activeIndex, Math.max(0, entries.length - 1))

    const kindLabel = activeTrigger.kind === 'wikilink' ? 'Wikilink suggestions' : activeTrigger.kind === 'hashtag' ? 'Tag suggestions' : 'Block command suggestions'
    menu.setAttribute('aria-label', kindLabel)
    menu.append(status)

    const heading = document.createElement('div')
    heading.className = 'suggestion-heading'
    heading.textContent = activeTrigger.kind === 'wikilink' ? 'Link a thread' : activeTrigger.kind === 'hashtag' ? 'Add a tag' : 'Change block'
    menu.append(heading)

    if (entries.length === 0) {
      const emptyText = activeTrigger.kind === 'wikilink' && !threadsReady
        ? 'Finding threads…'
        : activeTrigger.kind === 'hashtag' && !tagsReady
          ? 'Finding tags…'
        : activeTrigger.kind === 'wikilink'
          ? 'No matching threads'
          : activeTrigger.kind === 'hashtag'
            ? 'Type a name to create a tag'
          : 'No matching commands'
      const empty = document.createElement('div')
      empty.className = 'suggestion-empty'
      empty.textContent = emptyText
      menu.append(empty)
      menu.removeAttribute('aria-activedescendant')
      status.textContent = emptyText
    } else {
      status.textContent = `${entries.length} ${activeTrigger.kind === 'slash' ? 'command' : activeTrigger.kind === 'hashtag' ? 'tag' : 'thread'}${entries.length === 1 ? '' : 's'} found`
      menu.setAttribute('aria-activedescendant', optionId(activeIndex))
      entries.forEach((entry, index) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.id = optionId(index)
        button.className = `menu-item suggestion-option${index === activeIndex ? ' active' : ''}`
        button.setAttribute('role', 'option')
        button.setAttribute('aria-selected', String(index === activeIndex))
        button.tabIndex = -1

        const glyph = document.createElement('span')
        glyph.className = `suggestion-glyph suggestion-${entry.type === 'command' ? entry.command.id : entry.type}`
        glyph.textContent = entry.type === 'command' ? entry.command.glyph : entry.type === 'create-thread' || entry.type === 'create-tag' ? '+' : entry.type === 'tag' ? '#' : '•'
        if (entry.type === 'tag' && entry.color) glyph.style.setProperty('--tag-color', entry.color)

        const copy = document.createElement('span')
        copy.className = 'suggestion-copy'
        const title = document.createElement('strong')
        title.textContent = entry.type === 'command'
          ? entry.command.label
          : entry.type === 'create-thread'
            ? `Create “${entry.title}”`
            : entry.type === 'thread'
              ? entry.title
              : entry.type === 'create-tag'
                ? `Create #${entry.name}`
                : `#${entry.name}`
        const detail = document.createElement('small')
        detail.textContent = entry.type === 'command'
          ? entry.command.description
          : entry.type === 'create-thread'
            ? 'New thread'
            : entry.type === 'thread'
              ? 'Existing thread'
              : entry.type === 'create-tag'
                ? 'New tag'
                : entry.propertyCount > 0
                  ? `${entry.propertyCount} metadata field${entry.propertyCount === 1 ? '' : 's'}`
                  : 'Existing tag'
        copy.append(title, detail)

        const shortcut = document.createElement('span')
        shortcut.className = 'suggestion-shortcut'
        shortcut.textContent = entry.type === 'command' ? `/${entry.command.id}` : '↵'
        button.append(glyph, copy, shortcut)
        button.addEventListener('pointerenter', () => {
          activeIndex = index
          menu.setAttribute('aria-activedescendant', optionId(activeIndex))
          menu.querySelectorAll<HTMLElement>('.suggestion-option').forEach((option, optionIndex) => {
            option.classList.toggle('active', optionIndex === activeIndex)
            option.setAttribute('aria-selected', String(optionIndex === activeIndex))
          })
        })
        button.addEventListener('pointerdown', (event) => {
          event.preventDefault()
          event.stopPropagation()
          accept(entry)
        })
        menu.append(button)
      })
    }

    const hint = document.createElement('div')
    hint.className = 'suggestion-hint'
    hint.textContent = '↑↓ navigate  ·  ↵ select  ·  esc close'
    menu.append(hint)
    menu.hidden = false
    window.requestAnimationFrame(positionMenu)
  }

  const loadThreads = () => {
    const currentRequest = ++requestId
    void options.getThreads().then((nextThreads) => {
      if (currentRequest !== requestId) return
      threads = nextThreads
      threadsReady = true
      if (activeTrigger?.kind === 'wikilink') render()
    }).catch(() => {
      if (currentRequest === requestId) {
        threads = []
        threadsReady = true
        if (activeTrigger?.kind === 'wikilink') render()
      }
    })
  }

  const loadTags = () => {
    const currentRequest = ++requestId
    void options.getTags().then((nextTags) => {
      if (currentRequest !== requestId) return
      tags = nextTags
      tagsReady = true
      if (activeTrigger?.kind === 'hashtag') render()
    }).catch(() => {
      if (currentRequest === requestId) {
        tags = []
        tagsReady = true
        if (activeTrigger?.kind === 'hashtag') render()
      }
    })
  }

  const sync = () => {
    const trigger = triggerFromState(view.state)
    if (!trigger) {
      // The trigger syntax itself is gone (cursor moved away, or the trigger
      // character was deleted) -- clear the dismissal so a fresh trigger
      // elsewhere isn't accidentally suppressed by a stale key.
      activeTrigger = null
      previousKind = null
      dismissedTriggerKey = ''
      menu.hidden = true
      return
    }
    if (isTriggerDismissed(dismissedTriggerKey, trigger) || !view.hasFocus()) {
      activeTrigger = null
      previousKind = null
      menu.hidden = true
      return
    }

    const key = triggerKey(trigger)
    if (key !== lastTriggerKey) activeIndex = 0
    if (trigger.kind === 'wikilink' && previousKind !== 'wikilink') loadThreads()
    if (trigger.kind === 'hashtag' && previousKind !== 'hashtag') loadTags()
    activeTrigger = trigger
    previousKind = trigger.kind
    lastTriggerKey = key
    render()
  }

  const dismiss = () => {
    if (activeTrigger) dismissedTriggerKey = dismissKey(activeTrigger)
    activeTrigger = null
    menu.hidden = true
  }

  const handleKeyDown = (event: KeyboardEvent): boolean => {
    if (!activeTrigger || menu.hidden) return false
    if (event.key === 'Escape') {
      event.preventDefault()
      dismiss()
      return true
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && entries.length > 0) {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      activeIndex = (activeIndex + direction + entries.length) % entries.length
      render()
      return true
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && entries[activeIndex]) {
      event.preventDefault()
      accept(entries[activeIndex])
      return true
    }
    if (event.key === ' ' && activeTrigger.kind === 'hashtag' && activeTrigger.query.trim()) {
      const exact = entries.find((entry) => entry.type === 'tag' && entry.name.toLocaleLowerCase() === activeTrigger!.query.toLocaleLowerCase())
      const create = entries.find((entry) => entry.type === 'create-tag')
      const entry = exact ?? create
      if (entry) {
        event.preventDefault()
        accept(entry, true)
        return true
      }
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && ((activeTrigger.kind === 'wikilink' && !threadsReady) || (activeTrigger.kind === 'hashtag' && !tagsReady))) {
      event.preventDefault()
      return true
    }
    return false
  }

  const handleDocumentPointerDown = (event: PointerEvent) => {
    const target = event.target instanceof Node ? event.target : null
    if (!target || menu.contains(target) || view.dom.contains(target)) return
    dismiss()
  }
  const handleFocus = () => sync()
  const handleBlur = () => window.setTimeout(() => {
    if (!view.hasFocus()) menu.hidden = true
  }, 0)
  const handleViewportChange = () => positionMenu()
  document.addEventListener('pointerdown', handleDocumentPointerDown, true)
  view.dom.addEventListener('focus', handleFocus)
  view.dom.addEventListener('blur', handleBlur)
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('scroll', handleViewportChange, true)
  window.visualViewport?.addEventListener('resize', handleViewportChange)
  window.visualViewport?.addEventListener('scroll', handleViewportChange)
  sync()

  return {
    sync,
    handleKeyDown,
    destroy() {
      requestId += 1
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
      view.dom.removeEventListener('focus', handleFocus)
      view.dom.removeEventListener('blur', handleBlur)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
      window.visualViewport?.removeEventListener('resize', handleViewportChange)
      window.visualViewport?.removeEventListener('scroll', handleViewportChange)
      slashProvider.destroy()
      menu.remove()
    },
  }
}
