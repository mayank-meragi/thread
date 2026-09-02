import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db'
import { buildThreadScriptTools, createSessionAdapter, loadSessionHistory } from './aiChat'
import aiChatSource from './aiChat.ts?raw'

const streamTextMock = vi.fn()
vi.mock('ai', async (importActual) => {
  const actual = await importActual<typeof import('ai')>()
  return { ...actual, streamText: (...args: unknown[]) => streamTextMock(...args) }
})
vi.mock('./ai', () => ({
  getAIConfig: () => ({ provider: 'anthropic', apiKey: 'k', model: 'claude-x' }),
  resolveModel: () => ({}),
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

async function drain(adapter: ReturnType<typeof createSessionAdapter>, messages: unknown[], abortSignal: AbortSignal) {
  const stream = adapter.run({ messages, abortSignal, unstable_getMessage: () => ({ role: 'assistant', content: [] }) } as never) as AsyncGenerator<unknown>
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _ of stream) { /* consume the stream */ }
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

describe('createSessionAdapter streaming', () => {
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
    await db.chatSessions.put({ id: 's1', personaId: 'general', title: 'Chat', createdAt: '2026-09-02T10:00:00.000Z', updatedAt: '2026-09-02T10:00:00.000Z' })
  })

  it('keeps the partial reply when the stream is aborted (Stop)', async () => {
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

    const adapter = createSessionAdapter('s1', 'general')
    await expect(drain(adapter, [userMessage('u1', 'hi')], controller.signal)).resolves.toBeUndefined()

    const rows = await db.chatMessages.where('sessionId').equals('s1').sortBy('createdAt')
    expect(rows.map((row) => row.role)).toEqual(['user', 'assistant'])
    expect(rows[1].content).toBe('Hello ')
  })

  it('does not duplicate the user row when the same turn is re-run (Retry)', async () => {
    streamTextMock.mockImplementation(() => textStream(['first answer']))
    const adapter = createSessionAdapter('s1', 'general')
    await drain(adapter, [userMessage('u1', 'hi')], new AbortController().signal)

    streamTextMock.mockImplementation(() => textStream(['second answer']))
    await drain(adapter, [userMessage('u1', 'hi')], new AbortController().signal)

    const rows = await db.chatMessages.where('sessionId').equals('s1').sortBy('createdAt')
    expect(rows.filter((row) => row.role === 'user')).toHaveLength(1)
    expect(rows.filter((row) => row.role === 'assistant')).toHaveLength(1)
    expect(rows.find((row) => row.role === 'assistant')?.content).toBe('second answer')
  })
})

describe('createSessionAdapter approval gate', () => {
  beforeEach(async () => {
    streamTextMock.mockReset()
    await db.personas.put({
      id: 'general', name: 'General', icon: 'Bot', systemPrompt: 'You are helpful.',
      threadId: 'general', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    })
    await db.chatSessions.put({ id: 's1', personaId: 'general', title: 'Chat', createdAt: '2026-09-02T10:00:00.000Z', updatedAt: '2026-09-02T10:00:00.000Z' })
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

    const row = await db.chatMessages.where('sessionId').equals('s1').and((r) => r.role === 'assistant').first()
    expect(row?.status).toEqual({ type: 'requires-action', reason: 'tool-calls' })
  })

  it('finalizes the gated tool call from the proposal outcome when resumed', async () => {
    await db.chatProposals.put({
      id: 'prop-1', sessionId: 's1', status: 'completed',
      receipts: [{ actionIndex: 0, capability: 'thread.create', status: 'completed', idempotencyKey: 'k', at: '2026-09-02T10:01:00.000Z' }],
    } as never)
    const gatedPart = { type: 'tool-call' as const, toolCallId: 'tc-1', toolName: 'proposeThreadScript', args: {}, argsText: '{}', approval: { id: 'prop-1' } }
    await db.chatMessages.put({
      id: 'a1', sessionId: 's1', role: 'assistant', content: [gatedPart] as never,
      createdAt: '2026-09-02T10:00:30.000Z', status: { type: 'requires-action', reason: 'tool-calls' },
    })

    // The runtime resumes with the paused assistant message reachable only via
    // unstable_getMessage(); its tool-call part now carries approval.approved.
    const resumedMessage = { id: 'a1', role: 'assistant' as const, content: [{ ...gatedPart, approval: { id: 'prop-1', approved: true } }] }
    const updates = await collect(
      createSessionAdapter('s1', 'general'),
      [userMessage('u1', 'make a thread')],
      new AbortController().signal,
      () => resumedMessage,
    )

    const final = updates.at(-1)!
    expect(final.status).toEqual({ type: 'complete', reason: 'stop' })
    expect(final.content).toBeUndefined() // nothing appended to the message

    const row = await db.chatMessages.get('a1')
    expect(row?.status).toBeUndefined()
    const part = (row?.content as Array<Record<string, unknown>>)[0]
    expect(part.result).toMatchObject({ confirmed: true, status: 'completed' })
    expect((part.result as { receipts: unknown[] }).receipts).toHaveLength(1)
    expect(streamTextMock).not.toHaveBeenCalled()
  })
})

describe('loadSessionHistory', () => {
  it('round-trips a persisted assistant reply that carried a tool-call part', async () => {
    await db.chatMessages.bulkPut([
      { id: 'm1', sessionId: 's', role: 'user', content: 'plan me a workout', createdAt: '2026-09-02T10:00:00.000Z' },
      {
        id: 'm2',
        sessionId: 's',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Here is today’s session.' },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'proposeThreadScript',
            args: { source: 'action workout.buildDay' },
            result: { created: true, proposalId: 'prop-1' },
          },
        ],
        createdAt: '2026-09-02T10:00:01.000Z',
      },
    ])

    const history = await loadSessionHistory('s')

    expect(history[0].content).toBe('plan me a workout')
    expect(Array.isArray(history[1].content)).toBe(true)
    const parts = history[1].content as unknown as Array<Record<string, unknown>>
    expect(parts[0]).toMatchObject({ type: 'text', text: 'Here is today’s session.' })
    expect(parts[1]).toMatchObject({
      type: 'tool-call',
      toolName: 'proposeThreadScript',
      result: { created: true, proposalId: 'prop-1' },
    })
  })

  it('rehydrates a paused approval turn (status + tool-call approval)', async () => {
    await db.chatMessages.bulkPut([
      { id: 'm1', sessionId: 's', role: 'user', content: 'make a thread', createdAt: '2026-09-02T10:00:00.000Z' },
      {
        id: 'm2', sessionId: 's', role: 'assistant', createdAt: '2026-09-02T10:00:01.000Z',
        status: { type: 'requires-action', reason: 'tool-calls' },
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'proposeThreadScript', args: {}, argsText: '{}', approval: { id: 'prop-9' } }],
      },
    ])

    const history = await loadSessionHistory('s')

    expect(history[1].status).toEqual({ type: 'requires-action', reason: 'tool-calls' })
    const parts = history[1].content as unknown as Array<Record<string, unknown>>
    expect(parts[0]).toMatchObject({ type: 'tool-call', toolName: 'proposeThreadScript', approval: { id: 'prop-9' } })
    expect(history[0].status).toBeUndefined()
  })
})
