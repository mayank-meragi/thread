import { Button } from 'fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Copy, History, Plus, RotateCcw, Square } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  BranchPickerPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  ThreadPrimitive,
  useAuiState,
  useLocalRuntime,
  useRemoteThreadListRuntime,
} from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import { db, type PersonaRecord } from '../../db'
import { GENERAL_PERSONA_ID, WORKOUT_COACH_PERSONA_ID } from '../../lib/personas'
import { createSessionAdapter } from '../../lib/aiChat'
import { createChatHistoryAdapter } from '../../lib/chatHistory'
import { createChatThreadListAdapter } from '../../lib/chatThreadList'
import { ChatReasoning } from '../chat/ChatReasoning'
import { ComposerModelBar } from '../chat/ComposerModelBar'
import { PersonaSwitcher } from '../chat/PersonaSwitcher'
import { ThreadScriptProposal } from '../chat/ThreadScriptProposal'
import { ToolCallCard } from '../chat/ToolCallCard'

// MarkdownTextPrimitive reads the current message part's text via its own
// context hook rather than a `text` prop, so it doesn't literally match the
// `Text` slot's prop type -- wrap it to satisfy that without passing anything.
// The `chat-markdown` class is the hook the streaming caret CSS targets: the
// primitive stamps `data-status="running"` on this container while text (or its
// smooth-reveal tail) is still arriving.
function AssistantMarkdown() {
  return <MarkdownTextPrimitive className="chat-markdown" />
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

function relativeTime(date: Date | undefined): string {
  if (!date) return ''
  const minutes = Math.round((Date.now() - date.getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
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
          Reasoning: ChatReasoning,
          tools: { by_name: TOOL_UI },
        }}
      />
      <MessagePrimitive.Error>
        <p className="banner banner-error chat-message-error">Something went wrong. Check your AI provider settings.</p>
      </MessagePrimitive.Error>
      <div className="chat-message-footer">
        {/* Regenerate (Reload below) forks the turn into branches; without this
            row the earlier replies would be unreachable. Hidden at 1 branch. */}
        <BranchPickerPrimitive.Root className="chat-branch-picker" hideWhenSingleBranch>
          <BranchPickerPrimitive.Previous className="chat-action-btn" aria-label="Previous reply">
            <ChevronLeft size={13} />
          </BranchPickerPrimitive.Previous>
          <span className="chat-branch-count">
            <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
          </span>
          <BranchPickerPrimitive.Next className="chat-action-btn" aria-label="Next reply">
            <ChevronRight size={13} />
          </BranchPickerPrimitive.Next>
        </BranchPickerPrimitive.Root>
        <ActionBarPrimitive.Root className="chat-action-bar" hideWhenRunning autohide="not-last" autohideFloat="single-branch">
          <ActionBarPrimitive.Copy className="chat-action-btn" aria-label="Copy">
            <Copy size={13} />
          </ActionBarPrimitive.Copy>
          <ActionBarPrimitive.Reload className="chat-action-btn" aria-label="Retry">
            <RotateCcw size={13} />
          </ActionBarPrimitive.Reload>
        </ActionBarPrimitive.Root>
      </div>
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
        <div className="chat-composer-controls">
          <ComposerModelBar />
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
        </div>
      </ComposerPrimitive.Root>
    </ThreadPrimitive.Root>
  )
}

// One row of the session list -- rendered inside a `threadListItem` scope by
// ThreadListPrimitive.Items. Selecting one switches the runtime to that thread;
// `onSelect` flips the panel back to the chat view.
function SessionRow({ onSelect }: { onSelect: () => void }) {
  const title = useAuiState((s) => s.threadListItem.title)
  const lastMessageAt = useAuiState((s) => s.threadListItem.lastMessageAt)
  return (
    <ThreadListItemPrimitive.Root className="session-row">
      <ThreadListItemPrimitive.Trigger className="session-row-trigger" onClick={onSelect}>
        <span className="session-row-title">{title || 'Untitled'}</span>
        <small>{relativeTime(lastMessageAt)}</small>
      </ThreadListItemPrimitive.Trigger>
    </ThreadListItemPrimitive.Root>
  )
}

function SessionListView({ onSelect }: { onSelect: () => void }) {
  return (
    <div className="session-list">
      <ThreadListPrimitive.New className="session-list-new" onClick={onSelect}>
        <Plus size={13} /> New session
      </ThreadListPrimitive.New>
      <ThreadListPrimitive.Items>{() => <SessionRow onSelect={onSelect} />}</ThreadListPrimitive.Items>
    </div>
  )
}

// The chat-model + history adapters both need the active session id. Inside the
// thread-list runtime's per-thread scope that's `threadListItem.remoteId` once
// the thread is initialized, or its optimistic local `id` before the first
// message (our `initialize` returns `remoteId === id`, so this stays stable).
function useChatSessionRuntime(personaId: string) {
  const sessionId = useAuiState((s) => s.threadListItem.remoteId ?? s.threadListItem.id)
  const chatModel = useMemo(() => createSessionAdapter(sessionId, personaId), [sessionId, personaId])
  const history = useMemo(() => createChatHistoryAdapter(sessionId), [sessionId])
  // maxSteps >= 3: model turn -> approval-gate pause -> resume turn that closes
  // out the tool call.
  return useLocalRuntime(chatModel, { adapters: { history }, maxSteps: 4 })
}

type ChatView = 'chat' | 'history'

// Keyed by persona at the call site so switching personas fully remounts the
// thread-list runtime (fresh adapter, fresh remembered-session lookup).
function PersonaChat({
  personaId,
  personas,
  onChangePersona,
}: {
  personaId: string
  personas: PersonaRecord[]
  onChangePersona: (personaId: string) => void
}) {
  const [view, setView] = useState<ChatView>('chat')
  const adapter = useMemo(() => createChatThreadListAdapter(personaId), [personaId])

  // Controlled active-thread id: seed from the remembered session, else fall
  // back once to this persona's newest session; `undefined` = start on a new
  // (unpersisted) thread.
  const [threadId, setThreadId] = useState<string | undefined>(
    () => localStorage.getItem(activeSessionKey(personaId)) ?? undefined,
  )
  const fallbackResolved = useRef(threadId !== undefined)
  useEffect(() => {
    if (fallbackResolved.current) return
    fallbackResolved.current = true
    let cancelled = false
    void db.chatSessions
      .where('personaId')
      .equals(personaId)
      .reverse()
      .sortBy('updatedAt')
      .then((rows) => {
        const newest = rows.find((row) => (row.status ?? 'regular') === 'regular')
        if (!cancelled && newest) setThreadId(newest.id)
      })
    return () => {
      cancelled = true
    }
  }, [personaId])

  const runtime = useRemoteThreadListRuntime({
    runtimeHook: function RuntimeHook() {
      return useChatSessionRuntime(personaId)
    },
    adapter,
    threadId,
    onThreadIdChange: (id) => {
      setThreadId(id)
      if (id) localStorage.setItem(activeSessionKey(personaId), id)
      else localStorage.removeItem(activeSessionKey(personaId))
    },
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="chat-panel-header">
        <PersonaSwitcher personas={personas} activePersonaId={personaId} onChange={onChangePersona} />
        <div className="chat-panel-header-actions">
          <ThreadListPrimitive.New
            className="header-action"
            aria-label="New session"
            title="New session"
            onClick={() => setView('chat')}
          >
            <Plus size={15} />
          </ThreadListPrimitive.New>
          <Button unstyled
            type="button"
            className={view === 'history' ? 'header-action active' : 'header-action'}
            aria-label="Session history"
            title="Session history"
            onClick={() => setView((current) => (current === 'history' ? 'chat' : 'history'))}
          >
            <History size={15} />
          </Button>
        </div>
      </div>
      <div className="chat-panel-body">
        {view === 'history' ? (
          <SessionListView onSelect={() => setView('chat')} />
        ) : (
          <ChatThread personaId={personaId} />
        )}
      </div>
    </AssistantRuntimeProvider>
  )
}

export function ChatPanel() {
  const personas = useLiveQuery(() => db.personas.filter((persona) => !persona.archivedAt).toArray(), [], [])
  const [activePersonaId, setActivePersonaId] = useState(() => localStorage.getItem(ACTIVE_PERSONA_KEY) ?? GENERAL_PERSONA_ID)

  const changePersona = (personaId: string) => {
    setActivePersonaId(personaId)
    localStorage.setItem(ACTIVE_PERSONA_KEY, personaId)
  }

  return (
    <div className="chat-panel">
      <PersonaChat
        key={activePersonaId}
        personaId={activePersonaId}
        personas={personas}
        onChangePersona={changePersona}
      />
    </div>
  )
}
