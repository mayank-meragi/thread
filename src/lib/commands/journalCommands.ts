import { z } from 'zod'
import { appendPersonaJournalNote, db } from '../../db'
import { personaTarget, resolvePersona } from './resolve'
import { personaMutationResultSchema } from './schemas'
import { defineCommand, type CommandDefinition } from './types'

const takeNote = defineCommand({
  name: 'journal.takeNote',
  summary: 'Append a durable note under a persona heading in today’s journal.',
  category: 'journal',
  keywords: ['journal', 'persona', 'note', 'remember'],
  example: 'action journal.takeNote\n  persona: current\n  note: "Prefers concise weekly reviews."',
  risk: 'write',
  idempotency: 'receipt-required',
  inputSchema: z.object({ persona: z.string().trim().min(1).default('current'), note: z.string().trim().min(1) }).strict(),
  outputSchema: personaMutationResultSchema,
  resolve: async (input, context) => {
    const persona = await resolvePersona(input.persona, context.activePersonaId)
    const thread = await db.threads.get(persona.threadId)
    return { input, persona, heading: thread?.title ?? persona.name }
  },
  preview: ({ input, persona, heading }) => ({
    summary: `Add a journal note for “${persona.name}”`,
    changes: [{
      kind: 'append',
      target: personaTarget(persona),
      field: 'journal',
      description: `Append under [[${heading}]] in today’s journal`,
      after: input.note,
    }],
  }),
  execute: async ({ input, persona, heading }) => {
    await appendPersonaJournalNote(heading, input.note)
    return { persona: persona.id, changed: true }
  },
})

export const journalCommands: readonly CommandDefinition[] = [takeNote]
