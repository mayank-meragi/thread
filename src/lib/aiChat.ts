import { stepCountIs, streamText, tool } from 'ai'
import { z } from 'zod'
import type { ChatModelAdapter, ChatModelRunResult, ThreadAssistantMessagePart, ThreadMessage, ThreadMessageLike } from '@assistant-ui/react'
import { db, type PersonaRecord } from '../db'
import { getAIConfig, resolveModel } from './ai'
import { buildThreadSystemContext } from './aiContext'
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
    content: row.content,
    createdAt: new Date(row.createdAt),
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
  return `${persona.systemPrompt}${memory}\n\n${threadContext}`
}

function diagnosticOf(error: unknown): { code: string; message: string; line: number; column: number; length: number } {
  if (error instanceof ThreadScriptDiagnostic) {
    return { code: error.code, message: error.message, line: error.line, column: error.column, length: error.length }
  }
  return { code: 'invalid-document', message: error instanceof Error ? error.message : String(error), line: 1, column: 1, length: 0 }
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
        + 'including recording a durable journal note, via `action journal.takeNote`.',
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

export function createSessionAdapter(sessionId: string, personaId: string): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }): AsyncGenerator<ChatModelRunResult> {
      const persona = await db.personas.get(personaId)
      if (!persona) throw new Error('This persona no longer exists.')

      const lastMessage = messages[messages.length - 1]
      if (lastMessage?.role === 'user') {
        await db.chatMessages.put({
          id: crypto.randomUUID(),
          sessionId,
          role: 'user',
          content: textOf(lastMessage),
          createdAt: new Date().toISOString(),
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
        stopWhen: stepCountIs(8),
        abortSignal,
      })

      // `textStream` alone only carries text deltas -- it drops the tool-call
      // events entirely, so the UI would have no idea a tool ran. Walk
      // `fullStream` instead and build up an ordered parts array so a tool
      // call shows up as its own part in between the text that came before
      // and after it, the same shape a real multi-step response has.
      const parts: ThreadAssistantMessagePart[] = []
      let fullText = ''
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
          if (call?.type === 'tool-call') Object.assign(call, { result: event.output, isError: false })
        } else if (event.type === 'tool-error') {
          const call = parts.find((part) => part.type === 'tool-call' && part.toolCallId === event.toolCallId)
          if (call?.type === 'tool-call') Object.assign(call, { result: event.error, isError: true })
        } else {
          continue
        }
        yield { content: [...parts] }
      }

      await db.chatMessages.put({
        id: assistantMessageId,
        sessionId,
        role: 'assistant',
        content: fullText,
        createdAt: new Date().toISOString(),
      })
      await db.chatSessions.update(sessionId, { updatedAt: new Date().toISOString() })
    },
  }
}
