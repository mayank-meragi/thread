import { generateObject } from 'ai'
import { z } from 'zod'
import { getAIConfig, resolveModel } from './ai'
import { PERSONA_ICON_NAMES } from './icons'

const personaSchema = z.object({
  name: z.string().describe('A short, specific persona name (2-4 words), e.g. "Career Coach" or "Sleep Coach".'),
  icon: z.enum(PERSONA_ICON_NAMES).describe('The single best-fitting icon for this persona.'),
  systemPrompt: z
    .string()
    .describe('A thorough system prompt, written in second person ("You are..."), giving the assistant clear behavioral instructions for this persona.'),
})

export interface GeneratedPersona {
  name: string
  icon: string
  systemPrompt: string
}

// Told to the model so it writes a persona that actually fits how this app's
// chat works, rather than a generic "You are a helpful assistant" -- notably
// that it has a takeNote tool for remembering things about the user, and that
// each persona keeps its own thread of notes rather than sharing one memory.
const APP_CONTEXT = `This persona will run inside Thread, a personal notes and journaling app. Thread has one AI chat per persona, and each persona keeps its own journal thread of notes about the user that carries across sessions. During a chat, the assistant can call a "takeNote" tool to record something durable it learned about the user -- that note gets filed into the user's journal under this persona's heading and is shown back to the assistant automatically in future sessions. A good system prompt should tell the assistant what this persona is for, how it should behave and what tone to take, and that it should use takeNote to remember things worth recalling later (preferences, ongoing situations, commitments, progress) rather than trying to hold everything in the current conversation.`

export async function generatePersonaFromDescription(description: string): Promise<GeneratedPersona> {
  const config = getAIConfig()
  if (!config) throw new Error('Set up an AI provider in Settings before generating a persona.')
  const trimmed = description.trim()
  if (!trimmed) throw new Error('Describe the persona you want first.')

  const { object } = await generateObject({
    model: resolveModel(config),
    schema: personaSchema,
    prompt: `${APP_CONTEXT}\n\nA user wants a new persona. Here is what they asked for, in their own words:\n"${trimmed}"\n\nDesign the best persona for this request.`,
  })
  return object
}
