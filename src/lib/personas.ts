import { db, ensureThreadNote, type PersonaRecord } from '../db'
import { slugifyThread } from './outline'

export const GENERAL_PERSONA_ID = 'general'

function normalizedTitleFor(name: string): string {
  return name.trim().toLocaleLowerCase()
}

// A persona's thread id is derived from its name exactly the way any other
// wiki-linked thread's id is (`slugifyThread`) -- not a random id -- so that
// typing `[[Persona Name]]` in the journal (which is how the AI's note-taking
// tool records notes, see `appendPersonaJournalNote` in db.ts) resolves to
// this same thread instead of creating a lookalike duplicate.
async function createPersonaThread(name: string): Promise<string> {
  const threadId = slugifyThread(name)
  const now = new Date().toISOString()
  const existingThread = await db.threads.get(threadId)
  await db.threads.put({
    id: threadId,
    title: name,
    normalizedTitle: normalizedTitleFor(name),
    createdAt: existingThread?.createdAt ?? now,
    updatedAt: now,
  })
  await ensureThreadNote(threadId)
  return threadId
}

export async function ensureGeneralPersona(): Promise<void> {
  const existing = await db.personas.get(GENERAL_PERSONA_ID)
  if (existing) return
  const now = new Date().toISOString()
  const threadId = await createPersonaThread('General')
  await db.personas.put({
    id: GENERAL_PERSONA_ID,
    name: 'General',
    icon: 'Sparkles',
    systemPrompt: 'You are a helpful, general-purpose assistant inside the user\'s personal notes app.',
    threadId,
    createdAt: now,
    updatedAt: now,
  })
}

// A persona's thread has no `[[wiki-link]]` mentions pointing to it (it's
// written to directly by the note-taking tool, never discovered through
// journal text), so it used to get swept up by the day-note orphan-pruning
// pass before that pass knew to exempt persona threads. Re-create any thread
// rows that were lost that way, for personas that already exist.
//
// Also migrates personas created before persona thread ids were switched to
// `slugifyThread(name)` (they used a random `persona-<uuid>` id instead) --
// without this, their notes would silently start filing into a *new*,
// disconnected `career-coach`-style thread the first time the note-taking
// tool ran, since the journal heading it writes only ever resolves to the
// slug of its own text.
export async function repairPersonaThreads(): Promise<void> {
  const personas = await db.personas.toArray()
  for (const persona of personas) {
    const correctThreadId = slugifyThread(persona.name)
    if (persona.threadId !== correctThreadId) {
      const staleThreadId = persona.threadId
      await createPersonaThread(persona.name)
      await db.personas.update(persona.id, { threadId: correctThreadId })
      const staleThread = await db.threads.get(staleThreadId)
      const staleNote = await db.threadNotes.get(staleThreadId)
      const staleMentions = await db.mentions.where('threadId').equals(staleThreadId).count()
      if (staleThread && !staleMentions) {
        await db.threads.delete(staleThreadId)
        if (staleNote) await db.threadNotes.delete(staleThreadId)
      }
      continue
    }
    if (await db.threads.get(persona.threadId)) continue
    await createPersonaThread(persona.name)
  }
}

export async function createPersona(input: { name: string; icon: string; systemPrompt: string }): Promise<PersonaRecord> {
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  const threadId = await createPersonaThread(input.name.trim())
  const persona: PersonaRecord = {
    id,
    name: input.name.trim(),
    icon: input.icon,
    systemPrompt: input.systemPrompt.trim(),
    threadId,
    createdAt: now,
    updatedAt: now,
  }
  await db.personas.put(persona)
  return persona
}

export async function updatePersona(
  id: string,
  changes: Partial<Pick<PersonaRecord, 'name' | 'icon' | 'systemPrompt'>>,
): Promise<void> {
  const previous = await db.personas.get(id)
  if (!previous) throw new Error('This persona no longer exists.')
  const now = new Date().toISOString()
  await db.personas.update(id, { ...changes, updatedAt: now })
  // Deliberately does NOT rename `db.threads` when the persona's display name
  // changes: the thread's id is `slugifyThread(the title it was created
  // with)`, and the note-taking tool always files new notes under a
  // `[[ThatOriginalTitle]]` heading (see `appendPersonaJournalNote` in
  // db.ts) so they keep resolving to this same thread. If the thread's title
  // were updated too, the next note would slugify to a different id and
  // silently start a second, disconnected thread. Renaming a thread
  // everywhere it's mentioned isn't something this app supports for ordinary
  // wiki-threads either, so the persona's chat-facing name can change freely
  // while its journal heading stays put.
}

export async function archivePersona(id: string): Promise<void> {
  if (id === GENERAL_PERSONA_ID) throw new Error('The General persona cannot be archived.')
  await db.personas.update(id, { archivedAt: new Date().toISOString() })
}

export async function createSession(personaId: string, title = 'Untitled'): Promise<string> {
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  await db.chatSessions.put({ id, personaId, title, createdAt: now, updatedAt: now })
  return id
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  await db.chatSessions.update(sessionId, { title: title.trim() || 'Untitled', updatedAt: new Date().toISOString() })
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.transaction('rw', db.chatSessions, db.chatMessages, async () => {
    await db.chatMessages.where('sessionId').equals(sessionId).delete()
    await db.chatSessions.delete(sessionId)
  })
}
