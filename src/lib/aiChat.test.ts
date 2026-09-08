import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db'
import { buildThreadScriptTools, createSessionAdapter, stopAfterProposal } from './aiChat'
import aiChatSource from './aiChat.ts?raw'

const streamTextMock = vi.fn()
vi.mock('ai', async (importActual) => {
  const actual = await importActual<typeof import('ai')>()
  return { ...actual, streamText: (...args: unknown[]) => streamTextMock(...args) }
})
vi.mock('./ai', () => ({
  getAIConfig: () => ({ provider: 'anthropic', model: 'claude-x', effort: 'off', keys: { anthropic: 'k' } }),
  resolveModel: () => ({}),
  resolveReasoningOptions: () => undefined,
}))

/** Build a `streamText`-shaped result whose fullStream yields the given text deltas. */
function textStream(chunks: string[], onChunk?: (index: number) => void) {
  return {
    fullStream: (async function* () {
      for (let i = 0; i < chunks.length; i++) {
        onChunk?.(i)
        yield { type: 'text-delta', text: chunks[i] }
      }
    })(),
  }
}

/** A `streamText` result whose fullStream emits reasoning deltas, then text deltas. */
function reasoningStream(reasoningChunks: string[], textChunks: string[]) {
  return {
    fullStream: (async function* () {
      yield { type: 'reasoning-start', id: 'r1' }
      for (const text of reasoningChunks) yield { type: 'reasoning-delta', id: 'r1', text }
      yield { type: 'reasoning-end', id: 'r1' }
      for (const text of textChunks) yield { type: 'text-delta', text }
    })(),
  }
}

function userMessage(id: string, text: string) {
  return { id, role: 'user' as const, content: [{ type: 'text' as const, text }] }
}

/** A `streamText` result whose fullStream calls `proposeThreadScript` and returns a proposalId. */
function proposeStream(proposalId: string) {
  return {
    fullStream: (async function* () {
      yield { type: 'tool-call', toolCallId: 'tc-1', toolName: 'proposeThreadScript', input: { source: 'action thread.create\n  title: "Atlas"\n' } }
      yield { type: 'tool-result', toolCallId: 'tc-1', output: { created: true, proposalId } }
    })(),
  }
}

async function collect(
  adapter: ReturnType<typeof createSessionAdapter>,
  messages: unknown[],
  abortSignal: AbortSignal,
  getMessage: () => unknown = () => ({ role: 'assistant', content: [] }),
) {
  const out: Array<{ content?: unknown; status?: { type: string; reason?: string } }> = []
  const stream = adapter.run({ messages, abortSignal, unstable_getMessage: getMessage } as never) as AsyncGenerator<never>
  for await (const value of stream) out.push(value)
  return out
}

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

afterAll(() => db.close())

const toolContext = { sessionId: 'session-1', personaId: 'general', assistantMessageId: 'assistant-1' }
const runOptions = { toolCallId: 'call-1', messages: [] } as never

describe('AI ThreadScript tool surface', () => {
  it('exposes exactly the four read/propose tools and no direct-write tool', () => {
    const tools = buildThreadScriptTools(toolContext)
    expect(Object.keys(tools).sort()).toEqual(['inspectTql', 'proposeThreadScript', 'threadScriptHelp', 'validateThreadScript'])
    expect('takeNote' in tools).toBe(false)
  })

  it('proposeThreadScript drafts a pending proposal linked to its assistant message', async () => {
    const tools = buildThreadScriptTools(toolContext)
    const result = await tools.proposeThreadScript.execute!({ source: 'action thread.create\n  title: "Atlas"\n' }, runOptions)

    expect(result).toMatchObject({ created: true, stepCount: 1 })
    const proposal = await db.chatProposals.get((result as { proposalId: string }).proposalId)
    expect(proposal).toMatchObject({ status: 'pending', sessionId: 'session-1', messageId: 'assistant-1' })
    expect(await db.threads.count()).toBe(0)
  })

  it('proposeThreadScript reports diagnostics and persists nothing for an invalid script', async () => {
    const tools = buildThreadScriptTools(toolContext)
    const result = await tools.proposeThreadScript.execute!({ source: 'action nonsense.command\n  foo: 1\n' }, runOptions)

    expect(result).toMatchObject({ created: false })
    expect((result as { diagnostics: unknown[] }).diagnostics.length).toBeGreaterThan(0)
    expect(await db.chatProposals.count()).toBe(0)
  })

  it('does not import the trusted dispatcher', () => {
    expect(aiChatSource).not.toMatch(/threadscript\/dispatch/)
  })
})

describe('stopAfterProposal', () => {
  const step = (results: Array<{ toolName: string; output: unknown }>) => ({ toolResults: results }) as never

  it('keeps the loop going after a failed draft so the model can retry', () => {
    const steps = [step([{ toolName: 'proposeThreadScript', output: { created: false, diagnostics: [{ message: 'nope' }] } }])]
    expect(stopAfterProposal({ steps })).toBe(false)
  })

  it('stops once a proposal is actually drafted', () => {
    const steps = [
      step([{ toolName: 'proposeThreadScript', output: { created: false } }]),
      step([{ toolName: 'proposeThreadScript', output: { created: true, proposalId: 'p1' } }]),
    ]
    expect(stopAfterProposal({ steps })).toBe(true)
  })

  it('gives up after three failed drafts', () => {
    const steps = [
      step([{ toolName: 'proposeThreadScript', output: { created: false } }]),
      step([{ toolName: 'proposeThreadScript', output: { created: false } }]),
      step([{ toolName: 'proposeThreadScript', output: { created: false } }]),
    ]
    expect(stopAfterProposal({ steps })).toBe(true)
  })

  it('ignores other tool results', () => {
    const steps = [step([{ toolName: 'inspectTql', output: { rows: [] } }])]
    expect(stopAfterProposal({ steps })).toBe(false)
  })
})

describe('createSessionAdapter streaming', () => {
  // `run` is now write-free -- persistence is the ThreadHistoryAdapter's job
  // (see chatHistory.test.ts). These assert the shape of what it yields.
  beforeEach(async () => {
    streamTextMock.mockReset()
    await db.personas.put({
      id: 'general',
      name: 'General',
      icon: 'Bot',
      systemPrompt: 'You are helpful.',
      threadId: 'general',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('keeps the partial reply and does not throw when the stream is aborted (Stop)', async () => {
    const controller = new AbortController()
    streamTextMock.mockImplementation(({ abortSignal }: { abortSignal: AbortSignal }) =>
      textStream(['Hello ', 'world'], (index) => {
        if (index === 1) {
          controller.abort()
          const error = new Error('aborted')
          error.name = 'AbortError'
          throw error
        }
        void abortSignal
      }),
    )

    const updates = await collect(createSessionAdapter('s1', 'general'), [userMessage('u1', 'hi')], controller.signal)
    expect(updates.at(-1)?.content).toEqual([{ type: 'text', text: 'Hello ' }])
  })

  it('captures streamed reasoning as a leading part, before the answer text', async () => {
    streamTextMock.mockImplementation(() => reasoningStream(['Let me ', 'think.'], ['The ', 'answer.']))
    const adapter = createSessionAdapter('s1', 'general')

    const updates = await collect(adapter, [userMessage('u1', 'hi')], new AbortController().signal)
    const finalContent = updates.at(-1)?.content as Array<{ type: string; text: string }>
    expect(finalContent.map((part) => part.type)).toEqual(['reasoning', 'text'])
    expect(finalContent[0]).toEqual({ type: 'reasoning', text: 'Let me think.' })
    expect(finalContent[1]).toEqual({ type: 'text', text: 'The answer.' })
  })

  it('yields nothing when the stream produces no tokens', async () => {
    streamTextMock.mockImplementation(() => textStream([]))
    const updates = await collect(createSessionAdapter('s1', 'general'), [userMessage('u1', 'hi')], new AbortController().signal)
    expect(updates).toEqual([])
  })
})

describe('createSessionAdapter approval gate', () => {
  beforeEach(async () => {
    streamTextMock.mockReset()
    await db.personas.put({
      id: 'general', name: 'General', icon: 'Bot', systemPrompt: 'You are helpful.',
      threadId: 'general', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('pauses on requires-action with an approval gate instead of dispatching', async () => {
    await db.chatProposals.put({ id: 'prop-1', sessionId: 's1', status: 'pending', receipts: [] } as never)
    streamTextMock.mockImplementation(() => proposeStream('prop-1'))

    const updates = await collect(createSessionAdapter('s1', 'general'), [userMessage('u1', 'make a thread')], new AbortController().signal)

    const final = updates.at(-1)!
    expect(final.status).toEqual({ type: 'requires-action', reason: 'tool-calls' })
    const part = (final.content as Array<Record<string, unknown>>).find((p) => p.type === 'tool-call')!
    expect(part.approval).toEqual({ id: 'prop-1' })
    expect(part.result).toBeUndefined()
    expect(await db.threads.count()).toBe(0)
  })

  it('ends the turn with no content and no model call when resumed after a decision', async () => {
    const gatedPart = { type: 'tool-call' as const, toolCallId: 'tc-1', toolName: 'proposeThreadScript', args: {}, argsText: '{}' }
    // The runtime resumes with the paused assistant message reachable only via
    // unstable_getMessage(); its tool-call part now carries approval.approved.
    const resumedMessage = { id: 'a1', role: 'assistant' as const, content: [{ ...gatedPart, approval: { id: 'prop-1', approved: true } }] }
    const updates = await collect(
      createSessionAdapter('s1', 'general'),
      [userMessage('u1', 'make a thread')],
      new AbortController().signal,
      () => resumedMessage,
    )

    expect(updates).toEqual([{ status: { type: 'complete', reason: 'stop' } }])
    expect(streamTextMock).not.toHaveBeenCalled()
  })
})
