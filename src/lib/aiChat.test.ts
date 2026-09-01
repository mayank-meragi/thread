import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { buildThreadScriptTools } from './aiChat'
import aiChatSource from './aiChat.ts?raw'

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
