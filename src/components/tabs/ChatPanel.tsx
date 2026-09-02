import { useEffect, useMemo, useState } from 'react'
import { FileCheck, History, Plus, Send } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useLocalRuntime, type ThreadMessageLike, type ToolCallMessagePartProps } from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import { db } from '../../db'
import { createSession, GENERAL_PERSONA_ID } from '../../lib/personas'
import { createSessionAdapter, loadSessionHistory } from '../../lib/aiChat'
import { PersonaSwitcher } from '../chat/PersonaSwitcher'
import { SessionList } from '../chat/SessionList'
import { ThreadScriptProposal } from '../chat/ThreadScriptProposal'

// MarkdownTextPrimitive reads the current message part's text via its own
// context hook rather than a `text` prop, so it doesn't literally match the
// `Text` slot's prop type -- wrap it to satisfy that without passing anything.
function AssistantMarkdown() {
  return <MarkdownTextPrimitive />
}

// The proposeThreadScript tool only ever *drafts* a pending proposal; the
// package renders this inline where the model called the tool, so the
// ThreadScript proposal card lives in the message flow (above the composer)
// rather than a separate panel. The tool's `result` carries the proposalId,
// and assistant replies persist their tool-call parts (see aiChat.ts), so the
// card is restored on reload.
function ProposeThreadScriptToolUI({ result }: ToolCallMessagePartProps<{ source?: string }>) {
  const payload = result as
    | { created?: boolean; proposalId?: string; diagnostics?: Array<{ message: string }> }
    | undefined

  if (payload?.created && payload.proposalId) {
    return <ThreadScriptProposal proposalId={payload.proposalId} />
  }

  const label = !payload
    ? 'Drafting a proposal…'
    : `Draft failed: ${payload.diagnostics?.[0]?.message ?? 'invalid script'}`
  return (
    <div className="chat-tool-call">
      <FileCheck size={13} />
      <span>{label}</span>
    </div>
  )
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
      <MessagePrimitive.Content
        components={{
          Text: AssistantMarkdown,
          tools: { by_name: { proposeThreadScript: ProposeThreadScriptToolUI } },
        }}
      />
      <MessagePrimitive.Error>
        <p className="banner banner-error chat-message-error">Something went wrong. Check your AI provider settings.</p>
      </MessagePrimitive.Error>
    </MessagePrimitive.Root>
  )
}

function ChatThread() {
  return (
    <ThreadPrimitive.Root className="chat-thread">
      <ThreadPrimitive.Viewport className="chat-viewport">
        <ThreadPrimitive.Empty>
          <p className="empty-hint">Say something to get started.</p>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
      </ThreadPrimitive.Viewport>
      <ComposerPrimitive.Root className="chat-composer">
        <ComposerPrimitive.Input className="chat-composer-input" placeholder="Message…" rows={1} />
        <ComposerPrimitive.Send className="chat-composer-send" aria-label="Send">
          <Send size={15} />
        </ComposerPrimitive.Send>
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
  const runtime = useLocalRuntime(adapter, { initialMessages })
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatThread />
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
