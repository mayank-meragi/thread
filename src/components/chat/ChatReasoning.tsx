import { useState } from 'react'
import { Brain, ChevronRight, Loader2 } from 'lucide-react'
import { MessagePartPrimitive, type ReasoningMessagePartProps } from '@assistant-ui/react'

// Renders a `reasoning` message part -- the model's streamed thinking -- as a
// collapsed disclosure above the answer. assistant-ui hands this component the
// part via `MessagePrimitive.Content`'s `Reasoning` slot (its default renders
// nothing); the body text and the streaming indicator come from the library's
// own part primitives so the smooth-streaming animation matches the answer.
export function ChatReasoning({ status }: ReasoningMessagePartProps) {
  // Always starts collapsed -- the user opens it if they want to read along.
  const [open, setOpen] = useState(false)
  const streaming = status.type === 'running'

  return (
    <div className="chat-reasoning">
      <button
        type="button"
        className="chat-tool-row"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight size={14} className="chat-tool-chevron" data-open={open || undefined} aria-hidden="true" />
        <Brain size={13} className="chat-reasoning-icon" aria-hidden="true" />
        <span className="chat-tool-label">{streaming ? 'Thinking…' : 'Thought process'}</span>
        <MessagePartPrimitive.InProgress>
          <span className="chat-tool-status" data-state="running" aria-hidden="true">
            <Loader2 size={13} className="chat-spin" />
          </span>
        </MessagePartPrimitive.InProgress>
      </button>

      {open ? (
        <div className="chat-reasoning-body">
          <MessagePartPrimitive.Text component="div" />
        </div>
      ) : null}
    </div>
  )
}
