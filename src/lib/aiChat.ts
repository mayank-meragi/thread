import { stepCountIs, streamText, tool, type StopCondition, type ToolSet } from 'ai'
import { z } from 'zod'
import type { ChatModelAdapter, ChatModelRunResult, ThreadAssistantMessagePart, ThreadMessage, ThreadMessageLike } from '@assistant-ui/react'
import { db, type ChatMessagePartRecord, type PersonaRecord } from '../db'
import { getAIConfig, resolveModel } from './ai'
import { buildThreadSystemContext, TRAINING_PLAN_THREAD_ID } from './aiContext'
import { WORKOUT_COACH_PERSONA_ID } from './personas'
import { loadSource, parseQuery, runQuery } from './query'
import { compileThreadScript, validateThreadScript } from './threadscript/compiler'
import { getThreadScriptHelp } from './threadscript/help'
import { resolvePlan } from './threadscript/plan'
import { createProposal } from './threadscript/proposals'
import { ThreadScriptDiagnostic } from './threadscript/types'

function textOf(message: ThreadMessage): string {
  return message.content
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

export async function loadSessionHistory(sessionId: string): Promise<ThreadMessageLike[]> {
  const rows = await db.chatMessages.where('sessionId').equals(sessionId).sortBy('createdAt')
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    // Stored as a bare string (plain text) or an ordered parts array (assistant
    // replies that carried a tool call). ThreadMessageLike accepts both.
    content: row.content as ThreadMessageLike['content'],
    createdAt: new Date(row.createdAt),
    // Rehydrate a turn that is still paused on an approval gate so the runtime
    // re-enters `requires-action` and the card's Confirm/Cancel stay live.
    ...(row.status ? { status: row.status } : {}),
  }))
}

// The heading text a note gets filed under is the thread's own (immutable)
// title, not the persona's current display name -- see the comment in
// `updatePersona` (personas.ts) for why those two can diverge after a rename.
async function journalHeadingFor(persona: PersonaRecord): Promise<string> {
  const thread = await db.threads.get(persona.threadId)
  return thread?.title ?? persona.name
}

// Notes accumulate as journal mentions (one per day they were written on)
// rather than one blob, since they now live in the day's markdown -- see
// `appendPersonaJournalNote` in db.ts. Excludes the `[[Heading]]` mention
// itself (its excerpt is just the heading text, not a real note).
async function buildSystemPrompt(persona: PersonaRecord, headingText: string): Promise<string> {
  const [mentions, threadContext] = await Promise.all([
    db.mentions.where('threadId').equals(persona.threadId).sortBy('day'),
    buildThreadSystemContext(),
  ])
  const notes = mentions
    .filter((mention) => mention.excerpt.trim().toLocaleLowerCase() !== headingText.trim().toLocaleLowerCase())
    .map((mention) => `- (${mention.day}) ${mention.excerpt}`)
    .join('\n')
  const memory = notes ? `\n\nYour notes from previous sessions with this user:\n${notes}` : ''
  let coachHint = ''
  if (persona.id === WORKOUT_COACH_PERSONA_ID) {
    coachHint = (await db.threads.get(TRAINING_PLAN_THREAD_ID))
      ? '\n\n[Coach phase: a Training Plan thread exists — you are in PHASE 2 (session programming).]'
      : '\n\n[Coach phase: no Training Plan thread yet — you are in PHASE 1 (intake interview).]'
  }
  return `${persona.systemPrompt}${memory}${coachHint}\n\n${threadContext}`
}

function diagnosticOf(error: unknown): { code: string; message: string; line: number; column: number; length: number } {
  if (error instanceof ThreadScriptDiagnostic) {
    return { code: error.code, message: error.message, line: error.line, column: error.column, length: error.length }
  }
  return { code: 'invalid-document', message: error instanceof Error ? error.message : String(error), line: 1, column: 1, length: 0 }
}

const MAX_PROPOSAL_ATTEMPTS = 3

// Stop once a proposal is actually drafted (the approval gate takes over), or
// after a few failed drafts so the model can't loop on a broken idea. A
// `created: false` result otherwise stays in context so the next step can read
// its diagnostics and retry with a corrected script.
export const stopAfterProposal: StopCondition<ToolSet> = ({ steps }) => {
  const outcomes = steps
    .flatMap((step) => step.toolResults)
    .filter((result) => result.toolName === 'proposeThreadScript')
    .map((result) => result.output as { created?: boolean } | undefined)
  if (outcomes.some((outcome) => outcome?.created === true)) return true
  return outcomes.length >= MAX_PROPOSAL_ATTEMPTS
}

// The complete AI-facing ThreadScript surface. Three read-only lookups plus
// `proposeThreadScript`, which only ever *drafts* a pending proposal. There is
// deliberately no model-callable execute -- Confirm lives in trusted UI.
export function buildThreadScriptTools(context: { sessionId: string; personaId: string; assistantMessageId: string }) {
  return {
    threadScriptHelp: tool({
      description: 'Look up ThreadScript syntax and the typed commands available for a topic. Read-only.',
      inputSchema: z.object({ topic: z.string().default('') }),
      execute: async ({ topic }) => getThreadScriptHelp(topic, { limit: 6 }),
    }),
    validateThreadScript: tool({
      description: 'Parse and type-check a ThreadScript source without creating a proposal. Read-only.',
      inputSchema: z.object({ source: z.string().min(1) }),
      execute: async ({ source }) => {
        const { plan, diagnostics } = validateThreadScript(source)
        return {
          valid: diagnostics.length === 0,
          diagnostics,
          description: plan?.description,
          risk: plan?.risk,
          actionCount: plan?.actions.length ?? 0,
          capabilities: plan?.actions.map((action) => action.capability) ?? [],
        }
      },
    }),
    inspectTql: tool({
      description: 'Run a read-only TQL query over threads or tags and return a bounded result set.',
      inputSchema: z.object({ query: z.string().min(1) }),
      execute: async ({ query }) => {
        const parsed = parseQuery(query)
        if (parsed.editable?.length) throw new Error('EDITABLE is not permitted in an inspection query.')
        const [rows, propertyDefs] = await Promise.all([loadSource(parsed.source), db.propertyDefinitions.toArray()])
        const result = runQuery(parsed, { rows, propertyDefs })
        return {
          columns: result.columns,
          rows: result.rows.slice(0, 50).map((row) => row.cells),
          rowCount: result.rows.length,
          truncated: result.rows.length > 50,
        }
      },
    }),
    proposeThreadScript: tool({
      description:
        'Compile a ThreadScript, preview its exact effects, and create a pending proposal for the user to '
        + 'review and confirm. Does NOT execute anything. This is the ONLY way to change the workspace — '
        + 'including recording a durable journal note, via `action journal.takeNote`. '
        + 'If it returns `created: false`, read `diagnostics`, fix the script, and call this tool again — '
        + 'do not ask the user to correct it.',
      inputSchema: z.object({ source: z.string().min(1) }),
      execute: async ({ source }) => {
        let compiled
        try {
          compiled = compileThreadScript(source)
        } catch (error) {
          return { created: false, diagnostics: [diagnosticOf(error)] }
        }
        let resolved
        try {
          resolved = await resolvePlan(compiled, { resolution: { activePersonaId: context.personaId } })
        } catch (error) {
          return {
            created: false,
            diagnostics: [{ code: 'resolution-error', message: error instanceof Error ? error.message : String(error), line: 1, column: 1, length: 0 }],
          }
        }
        const proposalId = await createProposal({
          sessionId: context.sessionId,
          personaId: context.personaId,
          messageId: context.assistantMessageId,
          compiled,
          resolved,
        })
        return {
          created: true,
          proposalId,
          description: resolved.preview.description,
          risk: resolved.preview.risk,
          stepCount: resolved.preview.steps.length,
          steps: resolved.preview.steps.map((step) => ({ capability: step.capability, summary: step.preview.summary, status: step.status })),
          warnings: resolved.preview.warnings,
          diagnostics: [],
        }
      },
    }),
  }
}

// After the user answers a `proposeThreadScript` approval gate (Confirm/Cancel
// in the card, which already ran the trusted dispatcher / cancel), the runtime
// resumes the loop and re-invokes `run`. The paused assistant message is not in
// `messages` (only prior turns are), so we read it from `getMessage()`: it now
// carries `approval.approved` on the tool-call part. Persist the resolved card
// state (drop the paused status), then end the turn -- no content, no model
// call. Returns null when this isn't a resumed approval turn.
async function finalizeApprovalGate(
  sessionId: string,
  getMessage: (() => ThreadMessage) | undefined,
): Promise<ChatModelRunResult | null> {
  let current: ThreadMessage
  try {
    if (!getMessage) return null
    current = getMessage()
  } catch {
    return null
  }
  if (current.role !== 'assistant') return null

  const toolPart = current.content.find(
    (part): part is Extract<typeof part, { type: 'tool-call' }> =>
      part.type === 'tool-call' && part.toolName === 'proposeThreadScript' && part.approval?.approved !== undefined,
  )
  if (!toolPart?.approval) return null

  const confirmed = toolPart.approval.approved === true
  const proposal = await db.chatProposals.get(toolPart.approval.id)
  const outcome = {
    confirmed,
    status: proposal?.status ?? (confirmed ? 'completed' : 'cancelled'),
    receipts: proposal?.receipts ?? [],
    ...(proposal?.error ? { error: proposal.error } : {}),
  }
  const parts: ChatMessagePartRecord[] = current.content.map((part) =>
    part.type === 'tool-call'
      ? part.toolCallId === toolPart.toolCallId
        ? { type: 'tool-call', toolCallId: part.toolCallId, toolName: part.toolName, args: part.args, argsText: part.argsText, approval: toolPart.approval, result: outcome, isError: !confirmed }
        : { type: 'tool-call', toolCallId: part.toolCallId, toolName: part.toolName, args: part.args, argsText: part.argsText, result: part.result, isError: part.isError }
      : { type: 'text', text: part.type === 'text' ? part.text : '' },
  )
  const existing = await db.chatMessages.get(current.id)
  await db.chatMessages.put({
    id: current.id,
    sessionId,
    role: 'assistant',
    content: parts,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  })
  await db.chatSessions.update(sessionId, { updatedAt: new Date().toISOString() })
  // No `content` -> the runtime appends nothing; only the status changes.
  return { status: { type: 'complete', reason: 'stop' } }
}

export function createSessionAdapter(sessionId: string, personaId: string): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal, unstable_getMessage }): AsyncGenerator<ChatModelRunResult> {
      const resumed = await finalizeApprovalGate(sessionId, unstable_getMessage)
      if (resumed) {
        yield resumed
        return
      }

      const persona = await db.personas.get(personaId)
      if (!persona) throw new Error('This persona no longer exists.')

      const lastMessage = messages[messages.length - 1]
      let userCreatedAt: string | undefined
      if (lastMessage?.role === 'user') {
        // Keyed by the runtime message id (not a fresh uuid) so a regenerate --
        // which re-runs with the same trailing user message -- upserts the same
        // row instead of inserting a duplicate. Keep the original timestamp so
        // the cleanup below can tell "replies from before this regenerate" apart.
        const existing = await db.chatMessages.get(lastMessage.id)
        userCreatedAt = existing?.createdAt ?? new Date().toISOString()
        await db.chatMessages.put({
          id: lastMessage.id,
          sessionId,
          role: 'user',
          content: textOf(lastMessage),
          createdAt: userCreatedAt,
        })
        await db.chatSessions.update(sessionId, { updatedAt: new Date().toISOString() })
      }

      const config = getAIConfig()
      if (!config) throw new Error('Set up an AI provider in Settings before starting a chat.')

      const headingText = await journalHeadingFor(persona)
      const system = await buildSystemPrompt(persona, headingText)
      const modelMessages = messages
        .filter((message): message is ThreadMessage & { role: 'user' | 'assistant' } => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({ role: message.role, content: textOf(message) }))

      // Fixed up front so `proposeThreadScript` can link the proposal it
      // creates to the assistant message this turn will persist below.
      const assistantMessageId = crypto.randomUUID()

      const result = streamText({
        model: resolveModel(config),
        system,
        messages: modelMessages,
        tools: buildThreadScriptTools({ sessionId, personaId, assistantMessageId }),
        // Halt the loop the moment a proposal is drafted -- the model must not
        // narrate past it; the turn pauses on the approval gate instead.
        stopWhen: [stepCountIs(8), stopAfterProposal],
        abortSignal,
      })

      // `textStream` alone only carries text deltas -- it drops the tool-call
      // events entirely, so the UI would have no idea a tool ran. Walk
      // `fullStream` instead and build up an ordered parts array so a tool
      // call shows up as its own part in between the text that came before
      // and after it, the same shape a real multi-step response has.
      const parts: ThreadAssistantMessagePart[] = []
      let fullText = ''
      try {
        for await (const event of result.fullStream) {
          if (event.type === 'text-delta') {
            fullText += event.text
            const last = parts.at(-1)
            if (last?.type === 'text') parts[parts.length - 1] = { type: 'text', text: last.text + event.text }
            else parts.push({ type: 'text', text: event.text })
          } else if (event.type === 'tool-call') {
            parts.push({
              type: 'tool-call',
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.input as Record<string, string>,
              argsText: JSON.stringify(event.input),
            })
          } else if (event.type === 'tool-result') {
            const call = parts.find((part) => part.type === 'tool-call' && part.toolCallId === event.toolCallId)
            if (call?.type === 'tool-call') {
              const output = event.output as { created?: boolean; proposalId?: string } | undefined
              if (call.toolName === 'proposeThreadScript' && output?.created && output.proposalId) {
                // Born as an assistant-ui approval gate -- never carries a
                // transient `result`. `finalizeApprovalGate` fills it on resume.
                Object.assign(call, { approval: { id: output.proposalId } })
              } else {
                Object.assign(call, { result: event.output, isError: false })
              }
            }
          } else if (event.type === 'tool-error') {
            const call = parts.find((part) => part.type === 'tool-call' && part.toolCallId === event.toolCallId)
            if (call?.type === 'tool-call') Object.assign(call, { result: event.error, isError: true })
          } else {
            continue
          }
          yield { content: [...parts] }
        }
      } catch (error) {
        // A deliberate Stop aborts the stream -- keep whatever streamed so far
        // (persisted below) instead of surfacing an error bubble. Anything that
        // isn't an abort is a real failure and still propagates.
        if (!abortSignal.aborted && (error as { name?: string } | undefined)?.name !== 'AbortError') throw error
      }

      // Stop hit before any token arrived -- don't leave a blank assistant row.
      if (parts.length === 0 && !fullText) return

      // On a regenerate the runtime re-runs with the same trailing user message;
      // drop the assistant reply(ies) from that turn onward so the rewritten
      // reply replaces them instead of stacking up. A brand-new turn has none.
      if (userCreatedAt) {
        const cutoff = userCreatedAt
        await db.chatMessages
          .where('sessionId')
          .equals(sessionId)
          .filter((row) => row.role === 'assistant' && row.createdAt >= cutoff)
          .delete()
      }

      // Approval gate: `proposeThreadScript` drafted a pending proposal. Persist
      // the turn as paused on `requires-action` and stop; the card's
      // Confirm/Cancel resolves it and re-invokes `run` (see finalizeApprovalGate).
      const gated = parts.some(
        (part) => part.type === 'tool-call' && part.toolName === 'proposeThreadScript' && part.approval,
      )
      if (gated) {
        await db.chatMessages.put({
          id: assistantMessageId,
          sessionId,
          role: 'assistant',
          content: parts as unknown as ChatMessagePartRecord[],
          createdAt: new Date().toISOString(),
          status: { type: 'requires-action', reason: 'tool-calls' },
        })
        await db.chatSessions.update(sessionId, { updatedAt: new Date().toISOString() })
        yield { content: parts, status: { type: 'requires-action', reason: 'tool-calls' } }
        return
      }

      await db.chatMessages.put({
        id: assistantMessageId,
        sessionId,
        role: 'assistant',
        // Keep the ordered parts when the reply carried a tool call (so an
        // inline tool-call UI, e.g. the ThreadScript proposal card, survives a
        // reload); otherwise a bare string is enough.
        content: parts.some((part) => part.type !== 'text')
          ? (parts as unknown as ChatMessagePartRecord[])
          : fullText,
        createdAt: new Date().toISOString(),
      })
      await db.chatSessions.update(sessionId, { updatedAt: new Date().toISOString() })
    },
  }
}
