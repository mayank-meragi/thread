import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Copy, History, Plus, RotateCcw, Square } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ActionBarPrimitive, AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useLocalRuntime, useMessagePartText, type ThreadMessageLike } from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import { db } from '../../db'
import { createSession, GENERAL_PERSONA_ID, WORKOUT_COACH_PERSONA_ID } from '../../lib/personas'
import { createSessionAdapter, loadSessionHistory } from '../../lib/aiChat'
import { PersonaSwitcher } from '../chat/PersonaSwitcher'
import { SessionList } from '../chat/SessionList'
import { ThreadScriptProposal } from '../chat/ThreadScriptProposal'
import { ToolCallCard } from '../chat/ToolCallCard'

// MarkdownTextPrimitive reads the current message part's text via its own
// context hook rather than a `text` prop, so it doesn't literally match the
// `Text` slot's prop type -- wrap it to satisfy that without passing anything.
function AssistantMarkdown() {
  const part = useMessagePartText()
  const streaming = part.status.type === 'running' && part.text.length > 0
  return (
    <>
      <MarkdownTextPrimitive />
      {/* Blinking caret only once text is actually streaming in -- gating on
          `running` alone shows it under the thinking dots before any token. */}
      {streaming && <span className="chat-cursor" aria-hidden="true" />}
    </>
  )
}

const SUGGESTIONS: Record<string, string[]> = {
  [WORKOUT_COACH_PERSONA_ID]: [
    'Plan my training week',
    'Build today’s workout',
    'How’s my recent volume trending?',
  ],
  default: [
    'What’s on my plate today?',
    'Summarize this week’s journal',
    'Draft a task from my notes',
  ],
}

function suggestionsFor(personaId: string): string[] {
  return SUGGESTIONS[personaId] ?? SUGGESTIONS.default
}

// Every ThreadScript tool call renders through assistant-ui's `by_name` slot.
// `proposeThreadScript` is the approval gate (ThreadScriptProposal, which reads
// the live chatProposals row and calls respondToApproval); the three read-only
// tools get a compact running -> complete -> error status card.
const TOOL_UI = {
  proposeThreadScript: ThreadScriptProposal,
  threadScriptHelp: ToolCallCard,
  validateThreadScript: ToolCallCard,
  inspectTql: ToolCallCard,
}

const ACTIVE_PERSONA_KEY = 'thread.active-persona'

function activeSessionKey(personaId: string): string {
  return `thread.active-session.${personaId}`
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="chat-message chat-message-user">
      <MessagePrimitive.Content />
    </MessagePrimitive.Root>
  )
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="chat-message chat-message-assistant">
      {/* Thinking dots while the run is active but no token has landed yet. */}
      <ThreadPrimitive.If running>
        <MessagePrimitive.If last>
          <MessagePrimitive.If hasContent={false}>
            <div className="chat-running" aria-label="Assistant is responding">
              <span />
              <span />
              <span />
            </div>
          </MessagePrimitive.If>
        </MessagePrimitive.If>
      </ThreadPrimitive.If>
      <MessagePrimitive.Content
        components={{
          Text: AssistantMarkdown,
          tools: { by_name: TOOL_UI },
        }}
      />
      <MessagePrimitive.Error>
        <p className="banner banner-error chat-message-error">Something went wrong. Check your AI provider settings.</p>
      </MessagePrimitive.Error>
      <ActionBarPrimitive.Root className="chat-action-bar" hideWhenRunning autohide="not-last" autohideFloat="single-branch">
        <ActionBarPrimitive.Copy className="chat-action-btn" aria-label="Copy">
          <Copy size={13} />
        </ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload className="chat-action-btn" aria-label="Retry">
          <RotateCcw size={13} />
        </ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  )
}

function ChatThread({ personaId }: { personaId: string }) {
  return (
    <ThreadPrimitive.Root className="chat-thread">
      <ThreadPrimitive.Viewport className="chat-viewport">
        <ThreadPrimitive.Empty>
          <div className="chat-empty">
            <p className="empty-hint">Say something to get started.</p>
            <div className="chat-suggestions">
              {suggestionsFor(personaId).map((prompt) => (
                <ThreadPrimitive.Suggestion key={prompt} className="chat-suggestion" prompt={prompt} send>
                  {prompt}
                </ThreadPrimitive.Suggestion>
              ))}
            </div>
          </div>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        <ThreadPrimitive.If empty={false}>
          <ThreadPrimitive.ScrollToBottom className="chat-scroll-bottom" aria-label="Scroll to latest">
            <ArrowDown size={14} />
          </ThreadPrimitive.ScrollToBottom>
        </ThreadPrimitive.If>
      </ThreadPrimitive.Viewport>
      <ComposerPrimitive.Root className="chat-composer">
        <ComposerPrimitive.Input className="chat-composer-input" placeholder="Message…" rows={1} autoFocus />
        <ThreadPrimitive.If running={false}>
          <ComposerPrimitive.Send className="chat-composer-send" aria-label="Send message">
            <ArrowUp size={16} />
          </ComposerPrimitive.Send>
        </ThreadPrimitive.If>
        <ThreadPrimitive.If running>
          <ComposerPrimitive.Cancel className="chat-composer-send chat-composer-stop" aria-label="Stop generating">
            <Square size={12} fill="currentColor" />
          </ComposerPrimitive.Cancel>
        </ThreadPrimitive.If>
      </ComposerPrimitive.Root>
    </ThreadPrimitive.Root>
  )
}

function ChatSessionRuntime({
  sessionId,
  personaId,
  initialMessages,
}: {
  sessionId: string
  personaId: string
  initialMessages: ThreadMessageLike[]
}) {
  const adapter = useMemo(() => createSessionAdapter(sessionId, personaId), [sessionId, personaId])
  // maxSteps >= 3: model turn -> approval-gate pause -> resume turn that closes
  // out the tool call.
  const runtime = useLocalRuntime(adapter, { initialMessages, maxSteps: 4 })
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatThread personaId={personaId} />
    </AssistantRuntimeProvider>
  )
}

// Keyed by sessionId at the call site so switching sessions remounts this
// fresh (initialMessages starts back at null) rather than needing to reset
// state from inside the effect.
function ChatSession({ sessionId, personaId }: { sessionId: string; personaId: string }) {
  const [initialMessages, setInitialMessages] = useState<ThreadMessageLike[] | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadSessionHistory(sessionId).then((messages) => {
      if (!cancelled) setInitialMessages(messages)
    })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  if (!initialMessages) return <div className="chat-thread-loading">Loading…</div>
  return <ChatSessionRuntime sessionId={sessionId} personaId={personaId} initialMessages={initialMessages} />
}

type ChatView = 'chat' | 'history'

export function ChatPanel() {
  const personas = useLiveQuery(() => db.personas.filter((persona) => !persona.archivedAt).toArray(), [], [])
  const [activePersonaId, setActivePersonaId] = useState(() => localStorage.getItem(ACTIVE_PERSONA_KEY) ?? GENERAL_PERSONA_ID)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [view, setView] = useState<ChatView>('chat')

  // No default value here -- `undefined` while the query is still loading is
  // load-bearing: it's what tells the effect below not to treat a
  // not-yet-resolved query as "this persona genuinely has zero sessions" and
  // create a redundant one.
  const sessions = useLiveQuery(
    () => db.chatSessions.where('personaId').equals(activePersonaId).reverse().sortBy('updatedAt'),
    [activePersonaId],
  )

  const changePersona = (personaId: string) => {
    setActivePersonaId(personaId)
    localStorage.setItem(ACTIVE_PERSONA_KEY, personaId)
    setActiveSessionId(localStorage.getItem(activeSessionKey(personaId)))
  }

  const changeSession = (sessionId: string) => {
    setActiveSessionId(sessionId)
    localStorage.setItem(activeSessionKey(activePersonaId), sessionId)
  }

  const selectSessionFromHistory = (sessionId: string) => {
    changeSession(sessionId)
    setView('chat')
  }

  const newSession = async () => {
    const id = await createSession(activePersonaId)
    changeSession(id)
    setView('chat')
  }

  // Once this persona's sessions have loaded, make sure `activeSessionId`
  // points at a real one -- restore the remembered id if it still exists,
  // otherwise fall back to the most recently updated session, creating one
  // if this persona has none yet.
  useEffect(() => {
    if (!sessions) return // still loading -- don't decide anything yet
    let cancelled = false
    if (sessions.length === 0) {
      void createSession(activePersonaId).then((id) => {
        if (!cancelled) changeSession(id)
      })
      return () => {
        cancelled = true
      }
    }
    const remembered = localStorage.getItem(activeSessionKey(activePersonaId))
    const resolved = remembered && sessions.some((session) => session.id === remembered) ? remembered : sessions[0].id
    void Promise.resolve().then(() => {
      if (!cancelled) setActiveSessionId(resolved)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePersonaId, sessions?.length])

  return (
    <div className="chat-panel">
      <div className="chat-panel-header">
        <PersonaSwitcher personas={personas} activePersonaId={activePersonaId} onChange={changePersona} />
        <div className="chat-panel-header-actions">
          <button type="button" className="header-action" aria-label="New session" title="New session" onClick={() => void newSession()}>
            <Plus size={15} />
          </button>
          <button
            type="button"
            className={view === 'history' ? 'header-action active' : 'header-action'}
            aria-label="Session history"
            title="Session history"
            onClick={() => setView((current) => (current === 'history' ? 'chat' : 'history'))}
          >
            <History size={15} />
          </button>
        </div>
      </div>
      <div className="chat-panel-body">
        {view === 'history' ? (
          <SessionList sessions={sessions ?? []} activeSessionId={activeSessionId} onSelect={selectSessionFromHistory} onCreate={newSession} />
        ) : activeSessionId ? (
          <ChatSession key={activeSessionId} sessionId={activeSessionId} personaId={activePersonaId} />
        ) : (
          <div className="chat-thread-loading">Loading…</div>
        )}
      </div>
    </div>
  )
}
