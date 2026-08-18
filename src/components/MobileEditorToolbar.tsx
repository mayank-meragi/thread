import {
  CircleHelp,
  Diamond,
  IndentDecrease,
  IndentIncrease,
  Lightbulb,
  Link2,
  List,
  ListTodo,
} from 'lucide-react'

export type ToolbarAction = 'outdent' | 'indent' | 'bullet' | 'task' | 'wikilink' | 'idea' | 'question' | 'decision'
export type ToolbarBlockKind = 'bullet' | 'task' | 'idea' | 'question' | 'decision'

interface MobileEditorToolbarProps {
  visible: boolean
  top: number
  activeKind: ToolbarBlockKind
  onAction: (action: ToolbarAction) => void
}

const actions = [
  { action: 'outdent', label: 'Outdent block', icon: IndentDecrease },
  { action: 'indent', label: 'Indent block', icon: IndentIncrease },
  { action: 'bullet', label: 'Bullet', icon: List, groupStart: true },
  { action: 'task', label: 'Task', icon: ListTodo },
  { action: 'wikilink', label: 'Thread link', icon: Link2, groupStart: true },
  { action: 'idea', label: 'Idea', icon: Lightbulb, groupStart: true },
  { action: 'question', label: 'Question', icon: CircleHelp },
  { action: 'decision', label: 'Decision', icon: Diamond },
] as const

export function MobileEditorToolbar({ visible, top, activeKind, onAction }: MobileEditorToolbarProps) {
  if (!visible) return null

  return (
    <div
      className="mobile-editor-toolbar"
      style={{ top }}
      role="toolbar"
      aria-label="Outline tools"
    >
      <div className="mobile-editor-toolbar-scroll">
        {actions.map((item) => {
          const { action, label, icon: Icon } = item
          const groupStart = 'groupStart' in item && item.groupStart
          const shortLabel = action === 'indent'
            ? 'Tab'
            : action === 'outdent'
              ? 'Back'
              : label === 'Thread link'
                ? 'Link'
                : label.replace(' block', '')
          const pressed = action !== 'wikilink' && action !== 'indent' && action !== 'outdent'
            ? activeKind === action
            : false
          return (
            <button
              key={action}
              type="button"
              className={`${groupStart ? 'group-start ' : ''}toolbar-${action}`}
              aria-label={label}
              aria-pressed={action === 'indent' || action === 'outdent' || action === 'wikilink' ? undefined : pressed}
              title={label}
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onAction(action)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onAction(action)
              }}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{shortLabel}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
