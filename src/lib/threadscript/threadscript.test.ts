import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { CommandRegistry, defineCommand } from '../commands'
import { compileThreadScript, validateThreadScript } from './compiler'
import { formatThreadScript } from './formatter'
import { parseThreadScript } from './parser'
import { ThreadScriptDiagnostic } from './types'

const COMPLETE_EXAMPLE = `plan "Create a weekly review template"

# The template becomes available to the following action.
action template.create as weekly
  title: "Weekly Review"
  content: """
    - Wins
    - Challenges
    - Decisions
  """
  properties:
    Status: "Not started"
    Review date: null

action template.enable
  thread: $weekly.thread
`

describe('ThreadScript parser', () => {
  it('parses plans, actions, multiline strings, maps, and references', () => {
    const ast = parseThreadScript(COMPLETE_EXAMPLE)

    expect(ast.description).toBe('Create a weekly review template')
    expect(ast.actions).toHaveLength(2)
    expect(ast.actions[0]).toMatchObject({ capability: 'template.create', alias: 'weekly' })
    expect(ast.actions[0].arguments.entries.map((entry) => entry.key)).toEqual(['title', 'content', 'properties'])
    expect(ast.actions[0].arguments.entries[1].value).toMatchObject({
      kind: 'string',
      multiline: true,
      value: '- Wins\n- Challenges\n- Decisions',
    })
    expect(ast.actions[1].arguments.entries[0].value).toMatchObject({
      kind: 'reference',
      alias: 'weekly',
      path: ['thread'],
    })
  })

  it('parses typed scalars, scalar lists, and mapping lists', () => {
    const ast = parseThreadScript(`action example.run
  enabled: true
  missing: null
  amount: -2.5
  dueDate: 2026-09-04
  tags:
    - Work
    - "Product launch"
  items:
    - title: "Prepare brief"
      dueDate: 2026-09-04
    - title: "Review brief"
      dueDate: null
`)
    const entries = ast.actions[0].arguments.entries
    expect(entries[0].value).toMatchObject({ kind: 'boolean', value: true })
    expect(entries[1].value).toMatchObject({ kind: 'null' })
    expect(entries[2].value).toMatchObject({ kind: 'number', value: -2.5 })
    expect(entries[3].value).toMatchObject({ kind: 'symbol', value: '2026-09-04' })
    expect(entries[4].value).toMatchObject({ kind: 'list', items: [{ value: 'Work' }, { value: 'Product launch' }] })
    expect(entries[5].value).toMatchObject({ kind: 'list', items: [{ kind: 'map' }, { kind: 'map' }] })
  })

  it('normalizes CRLF and rejects invalid indentation with a precise diagnostic', () => {
    expect(parseThreadScript('action thread.create\r\n  title: "A"\r\n').actions).toHaveLength(1)
    expect(() => parseThreadScript('action thread.create\n   title: "A"\n')).toThrowError(ThreadScriptDiagnostic)
    try {
      parseThreadScript('action thread.create\n   title: "A"\n')
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid-indentation', line: 2, column: 4 })
    }
  })

  it('rejects duplicate keys, duplicate aliases, and unterminated strings', () => {
    expect(() => parseThreadScript('action thread.create\n  title: "A"\n  title: "B"\n')).toThrow('Duplicate key')
    expect(() => parseThreadScript('action thread.create as item\n  title: "A"\naction thread.create as item\n  title: "B"\n')).toThrow('already in use')
    expect(() => parseThreadScript('action thread.create\n  title: "A\n')).toThrow('Unterminated quoted string')
    expect(() => parseThreadScript('action thread.content.append\n  thread: A\n  content: """\n    text\n')).toThrow('Unterminated multiline string')
    expect(() => parseThreadScript('action example.run\n  items:\n    - One\n    - title: "Two"\n')).toThrow('cannot mix')
  })

  it('formats to a stable canonical representation', () => {
    const formatted = formatThreadScript(parseThreadScript(COMPLETE_EXAMPLE))
    expect(formatThreadScript(parseThreadScript(formatted))).toBe(formatted)
    expect(formatted).toContain('action template.create as weekly')
    expect(formatted).toContain('  content: """\n    - Wins')
    expect(formatted.endsWith('\n')).toBe(true)
  })
})

describe('ThreadScript compiler', () => {
  it('compiles registered actions, applies schema defaults, and preserves symbolic references', () => {
    const plan = compileThreadScript(COMPLETE_EXAMPLE)

    expect(plan).toMatchObject({
      languageVersion: 1,
      description: 'Create a weekly review template',
      risk: 'write',
      actions: [
        {
          capability: 'template.create',
          alias: 'weekly',
          arguments: {
            title: 'Weekly Review',
            content: '- Wins\n- Challenges\n- Decisions',
            properties: { Status: 'Not started', 'Review date': null },
          },
        },
        {
          capability: 'template.enable',
          arguments: {
            thread: { $result: { alias: 'weekly', actionIndex: 0, path: ['thread'] } },
          },
        },
      ],
    })
    expect(plan.sourceHash).toMatch(/^[a-f0-9]{8}$/)
  })

  it('reports unknown commands with close suggestions', () => {
    const result = validateThreadScript('action templat.create\n  title: "Review"\n')
    expect(result.diagnostics[0]).toMatchObject({ code: 'unknown-command', line: 1 })
    expect(result.diagnostics[0].message).toContain('template.create')
  })

  it('rejects forward references and missing result fields', () => {
    expect(validateThreadScript(`action template.enable
  thread: $later.thread
action template.create as later
  title: "Later"
`).diagnostics[0]).toMatchObject({ code: 'invalid-reference', line: 2 })

    expect(validateThreadScript(`action template.create as template
  title: "Review"
action template.enable
  thread: $template.missing
`).diagnostics[0]).toMatchObject({ code: 'invalid-reference' })
  })

  it('type-checks references against the receiving input schema', () => {
    const result = validateThreadScript(`action template.create as template
  title: "Review"
action template.enable
  thread: $template.created
`)
    expect(result.diagnostics[0]).toMatchObject({ code: 'invalid-arguments' })
    expect(result.diagnostics[0].message).toContain('expected string')
  })

  it('reports strict command argument errors at the relevant argument', () => {
    const result = validateThreadScript(`action thread.create
  title: "Project"
  surprise: true
`)
    expect(result.diagnostics[0]).toMatchObject({ code: 'invalid-arguments', line: 3, column: 3 })
  })

  it('validates declared embedded TQL selectors and rejects EDITABLE', () => {
    const registry = new CommandRegistry().register(defineCommand({
      name: 'thread.bulkInspect',
      summary: 'Test query selectors.',
      category: 'test',
      keywords: ['test'],
      example: 'action thread.bulkInspect\n  threads:\n    query: "LIST FROM threads"',
      risk: 'write',
      idempotency: 'natural',
      queryArgumentPaths: ['threads.query'],
      inputSchema: z.object({ threads: z.object({ query: z.string() }) }),
      outputSchema: z.object({ count: z.number() }),
      resolve: async (input) => input,
      preview: () => ({ summary: 'Test', changes: [] }),
      execute: async () => ({ count: 0 }),
    }))

    expect(validateThreadScript(`action thread.bulkInspect
  threads:
    query: "LIST FROM threads WHERE status = blocked"
`, registry).diagnostics).toEqual([])

    const invalid = validateThreadScript(`action thread.bulkInspect
  threads:
    query: "LIST status FROM threads EDITABLE status"
`, registry)
    expect(invalid.diagnostics[0]).toMatchObject({ code: 'invalid-query' })
    expect(invalid.diagnostics[0].message).toContain('EDITABLE is not allowed')
  })
})
