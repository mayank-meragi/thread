import { stepCountIs, streamText, tool } from 'ai'
import { z } from 'zod'
import type { ChatModelAdapter, ChatModelRunResult, ThreadAssistantMessagePart, ThreadMessage, ThreadMessageLike } from '@assistant-ui/react'
import { appendPersonaJournalNote, db, type PersonaRecord } from '../db'
import { getAIConfig, resolveModel } from './ai'

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
  const mentions = await db.mentions.where('threadId').equals(persona.threadId).sortBy('day')
  const notes = mentions
    .filter((mention) => mention.excerpt.trim().toLocaleLowerCase() !== headingText.trim().toLocaleLowerCase())
    .map((mention) => `- (${mention.day}) ${mention.excerpt}`)
    .join('\n')
  if (!notes) return persona.systemPrompt
  return `${persona.systemPrompt}\n\nYour notes from previous sessions with this user:\n${notes}`
}

function takeNoteTool(headingText: string) {
  return tool({
    description: "Record something durable about the user for your own future reference across sessions -- like a note you'd jot down mid-conversation. Filed into today's journal under this persona's heading.",
    inputSchema: z.object({ note: z.string().describe('The note to remember, written in your own words.') }),
    execute: async ({ note }) => {
      await appendPersonaJournalNote(headingText, note)
      return { saved: true }
    },
  })
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

      const result = streamText({
        model: resolveModel(config),
        system,
        messages: modelMessages,
        tools: { takeNote: takeNoteTool(headingText) },
        stopWhen: stepCountIs(5),
        abortSignal,
      })

      // `textStream` alone only carries text deltas -- it drops the tool-call
      // events entirely, so the UI would have no idea `takeNote` ran even
      // though it did (silently, server-side). Walk `fullStream` instead and
      // build up an ordered parts array so a tool call shows up as its own
      // part in between the text that came before and after it, the same
      // shape a real multi-step response has.
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
            args: event.input as { note: string },
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
        id: crypto.randomUUID(),
        sessionId,
        role: 'assistant',
        content: fullText,
        createdAt: new Date().toISOString(),
      })
      await db.chatSessions.update(sessionId, { updatedAt: new Date().toISOString() })
    },
  }
}
