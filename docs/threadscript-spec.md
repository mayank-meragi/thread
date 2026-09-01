# ThreadScript v1 specification

Status: implementation specification  
Language version: 1  
Last reviewed: 2026-09-01

ThreadScript is Thread's one-shot action language. It lets AI chat describe a reviewable workflow
without receiving a separate tool for every application operation. Thread parses the script,
resolves it into trusted domain commands, shows the exact effects, and waits for the user to approve
or cancel them.

ThreadScript is not an execution permission. Producing a valid script or creating a proposal does
not authorize any domain change.

Current and planned application coverage is tracked in the
[ThreadScript capability inventory](threadscript-capability-inventory.md).

## 1. Goals

ThreadScript v1 is designed to be:

- compact enough for frequent model generation,
- readable in a chat approval card,
- deterministic to parse and format,
- typed by the shared command registry,
- composable across multiple application operations,
- capable of referencing earlier action results,
- able to reuse existing TQL for read-only target selection,
- safe to dry-run and preview,
- inert until trusted UI records user approval.

ThreadScript is the AI-facing authoring layer. Registered commands remain the authorization,
validation, preview, and execution layer used underneath it.

## 2. Non-goals for v1

Version 1 does not include:

- loops, branches, functions, arithmetic, or general expressions,
- arbitrary JavaScript, SQL, Dexie, DOM, URL, or shell access,
- string interpolation,
- implicit deletion based on an omitted object,
- mutation statements inside existing live `tql` query blocks,
- scheduled or continuously reconciled execution,
- model-issued approval or an AI-callable execution operation,
- secret values supplied by or revealed to the model.

Human-friendly shorthand such as `apply template "Weekly Review" to thread "Project X"` may be
added later as syntax sugar. V1 uses one uniform action-block form.

## 3. Example

```thread
plan "Create and open a weekly review template"

action template.create as weekly
  title: "Weekly Review"
  content: """
    - Wins
    - Challenges
    - Decisions
    - Priorities
  """
  properties:
    Status: "Not started"
    Review date: null

action view.openThread
  thread: $weekly.thread
```

The second action may be unsupported during the first implementation slice even though the grammar
can represent it. Capability availability is determined by the command registry, not the parser.

## 4. Source format

- Source is UTF-8 text.
- Line endings may be LF or CRLF; parsers normalize them to LF.
- Indentation is two spaces per level in canonical output.
- Tabs in indentation are invalid.
- Blank lines are ignored outside multiline strings.
- A `#` begins a comment when it is the first non-whitespace character on a line.
- Inline comments are not supported in v1, avoiding ambiguity with tag-like values and content.
- Action and argument names are case-sensitive.
- A canonical formatter ends the file with one newline.

## 5. Document structure

A document contains:

1. an optional `plan` declaration,
2. one or more `action` blocks.

```text
document      := blank-or-comment* plan? action+
plan          := "plan" space string newline
action        := "action" space action-name (space "as" space alias)? newline argument+
action-name   := lower-name ("." lower-name)+
alias         := lower-name
lower-name    := [a-z][a-zA-Z0-9]*
```

Constraints:

- `plan` may appear at most once and must precede all actions.
- A document must contain at least one action.
- An action must contain at least one argument in v1.
- Action names must be namespaced, for example `template.create`.
- Aliases must be unique within the document.
- Argument names must be unique within the same mapping.

The parser reports structural errors. Whether an action exists and which arguments it accepts are
semantic questions answered by the command registry.

## 6. Values

### 6.1 Quoted strings

Double-quoted strings are the canonical scalar text form:

```thread
title: "Project X"
```

Supported escapes are `\"`, `\\`, `\n`, `\r`, and `\t`. Unknown escapes are errors. Single-quoted
strings are not supported in v1.

### 6.2 Symbols

An unquoted identifier is a symbol value:

```thread
value: High
status: in_progress
```

Symbols match `[A-Za-z_][A-Za-z0-9_-]*` and are delivered to schema validation as strings. The
formatter preserves their spelling. Strings containing spaces or punctuation must be quoted.

The reserved symbols `true`, `false`, and `null` are typed literals rather than strings.

### 6.3 Numbers

Integers and decimal numbers are supported:

```thread
minutes: 90
confidence: 0.8
```

Leading `+`, exponent notation, `NaN`, and infinities are not supported. A leading `-` is allowed.

### 6.4 Multiline strings

Triple double quotes delimit multiline strings:

```thread
content: """
  - First block
    - Nested block
  - Second block
"""
```

Rules:

- The opening delimiter must be the complete value after `:`.
- Content begins on the following line.
- The closing delimiter appears on its own line at the argument's indentation.
- The parser removes the common indentation belonging to the value block.
- Newlines inside the value are preserved and normalized to LF.
- The value does not gain an extra trailing newline merely because the closing delimiter is on the
  next line.
- Triple quotes cannot be escaped inside a multiline value in v1.

### 6.5 Mappings

A key followed by `:` and no value begins a nested mapping:

```thread
properties:
  Status: "Not started"
  Review date: null
```

Mapping keys extend to the colon, are trimmed, and may contain spaces. Empty keys and duplicate keys
at the same level are invalid. The command schema decides whether a human-facing key such as
`Review date` is valid.

### 6.6 Lists

A key followed by `:` may contain a list of scalar values or mappings:

```thread
tags:
  - Work
  - "Product launch"
```

```thread
items:
  - title: "Prepare brief"
    dueDate: 2026-09-04
  - title: "Review brief"
    dueDate: null
```

Inline list and object syntax is not supported in v1. Mixed scalar and mapping items in one list are
invalid.

### 6.7 Result references

A reference uses the result of an earlier aliased action:

```thread
thread: $project.thread
```

```text
reference := "$" alias ("." field)+
```

Rules:

- The alias must refer to an earlier action.
- Forward and circular references are invalid.
- Every field must exist in the registered output schema.
- A reference occupies the complete value; interpolation such as `"Thread $project.id"` is invalid.
- Reference values are resolved during plan execution, but their output path is validated when the
  proposal is compiled.

## 7. Embedded TQL selectors

ThreadScript reuses the existing TQL parser for read-only selection:

```thread
action property.set
  threads:
    query: """
      LIST FROM threads WHERE status = blocked
    """
  property: Priority
  value: High
```

An argument schema explicitly declares when it accepts a query selector. The compiler:

1. parses the string with the existing TQL parser,
2. runs it through read-only sources,
3. captures the resulting stable row IDs,
4. passes those IDs to command resolution,
5. includes every affected object in the preview.

The presentation selector (`LIST` or `TABLE`) does not change action semantics. `EDITABLE` is
rejected inside ThreadScript selectors because the selector is read-only. Existing live TQL blocks
remain unchanged and cannot contain ThreadScript actions.

If the selector resolves to a different target set before confirmation, the proposal is stale and
must be previewed and approved again.

## 8. Parsing and semantic validation

Validation occurs in layers:

### Syntax validation

The ThreadScript parser checks:

- indentation and block structure,
- document ordering,
- literal syntax,
- duplicate mapping keys,
- aliases and reference syntax,
- multiline-string termination.

Diagnostics contain a message, one-based line and column, span length when known, and a stable error
code.

### Registry validation

The compiler checks:

- that every action exists,
- that arguments conform to the action's input schema,
- that no unknown arguments were provided,
- that required arguments exist,
- that result reference paths conform to prior output schemas,
- that query selectors are permitted for the relevant argument,
- that the command is available in the current Thread version.

Unknown action diagnostics should include up to three close registered names.

### Resolution validation

The command resolver checks live application state:

- titles/names resolve unambiguously to stable IDs,
- referenced objects still exist,
- property values match property types and options,
- commands are valid for their targets,
- protected system records are not modified illegally,
- bulk scopes remain within configured safety limits.

The model never chooses which validation errors to ignore.

## 9. Command plans

A valid script compiles to a plan, not directly to writes:

```ts
interface CommandPlan {
  languageVersion: 1
  description?: string
  source: string
  sourceHash: string
  commands: PlannedCommand[]
  risk: 'write' | 'destructive' | 'external'
}

interface PlannedCommand {
  id: string
  actionIndex: number
  capability: string
  alias?: string
  validatedArguments: unknown
  resolvedTargets: ResolvedTarget[]
  expectedVersions: Record<string, string | number>
  idempotencyKey: string
}
```

The plan retains original source locations for diagnostics and result display. Secrets are not valid
ThreadScript values and are never included in a plan.

## 10. Preview contract

Every command definition must generate a preview from its resolved command. A proposal cannot enter
the pending state if any command lacks a preview.

A preview contains:

- plan description,
- action order,
- exact stable targets and display names,
- before and after values where applicable,
- content appended, replaced, created, archived, or deleted,
- external destination and scope,
- warnings and risk classification,
- the raw formatted ThreadScript as a secondary disclosure.

Previewing is side-effect free. It may read local application state and perform deterministic
validation, but it may not write domain data, alter workspace state, contact an external service, or
request a secret.

## 11. Approval and execution

The lifecycle is:

```text
draft -> invalid
      -> pending -> cancelled
                 -> stale
                 -> executing -> completed
                              -> failed
```

Creating a pending proposal may persist chat/proposal metadata only. No command handler runs before
trusted UI receives a direct user confirmation.

On confirmation the dispatcher must:

1. reload the persisted proposal,
2. verify that its status is `pending`,
3. parse and validate the stored source again,
4. resolve targets against current application state,
5. compare targets, expected versions, and previewed effects with the approved plan,
6. mark changed plans `stale` and require a new approval,
7. atomically claim an unchanged proposal for execution,
8. execute commands in order through the registry,
9. store a receipt for each command,
10. persist results or a precise failure.

Confirm and Cancel are trusted application controls. They are not ThreadScript actions and are not
AI tools. A script field such as `approved: true` is an unknown argument and cannot grant authority.

## 12. Idempotency and failure behavior

- Every planned command has a stable idempotency key derived from the proposal and action index.
- The dispatcher records a receipt before treating a command as completed.
- A completed receipt is returned on retry instead of executing the command again.
- Commands should be transactionally grouped when they share a compatible Dexie transaction.
- Where a universal transaction is impossible, completed results are retained and the failure names
  the first command that did not complete.
- Retrying a partially completed plan skips receipted commands after revalidation.
- Destructive commands must document whether and how their result can be recovered.

The system promises idempotent recovery, not magical rollback across local and external systems.

## 13. Risk and permission policy

| Operation | Example | Initial policy |
|---|---|---|
| Read-only help/validation | Learn template syntax, validate a script | Run automatically |
| Read-only inspection | Query templates or property definitions | Run automatically |
| Proposal creation | Persist script and dry-run preview | Run automatically; no domain effect |
| Content write | Create a template, update a property | Confirm exact changes |
| Workspace action | Open a tab, change layout | Confirm action |
| External action | Sync, pull, export, call another provider | Confirm destination and scope |
| Destructive action | Delete, archive, replace, disconnect | Strong warning and confirmation |

Future permission grants may reduce prompts for low-risk workspace actions, but grants must be
explicit, scoped, revocable, and stored outside model-controlled input.

## 14. Secrets

Provider API keys, GitHub tokens, and comparable credentials:

- are never returned by read tools,
- are never included in system prompts,
- are invalid as ThreadScript arguments,
- are never persisted in proposal source, previews, logs, or results,
- are entered only into trusted user-only controls during confirmation when required.

The command may reference a credential slot such as `credential: github`, but it cannot read or set
the secret value itself.

## 15. Minimal AI surface

AI chat receives four ThreadScript-related operations:

```text
threadScriptHelp(topic)
validateThreadScript(source)
inspectTql(query)
proposeThreadScript(source)
```

- `threadScriptHelp` returns compact registry-generated help for relevant actions.
- `validateThreadScript` parses and type-checks without persisting a proposal.
- `inspectTql` executes read-only TQL and returns bounded results.
- `proposeThreadScript` persists a resolved preview in `pending` state.

There is deliberately no model-callable execute operation.

## 16. Initial action vocabulary

The first implementation slice registers:

| Action | Required behavior |
|---|---|
| `thread.create` | Create or resolve a named thread without clobbering existing content. |
| `thread.rename` | Rename a resolved thread while retaining its stable ID. |
| `thread.content.append` | Append Markdown with a visible content preview. |
| `thread.content.replace` | Replace Markdown with a destructive warning and full diff. |
| `template.create` | Create a thread, seed content/properties, and enable it as a template. |
| `template.enable` | Mark a resolved thread as a template. |
| `template.disable` | Remove template status without deleting the thread. |
| `template.apply` | Apply a resolved template using existing non-clobbering property behavior. |
| `property.create` | Create a typed property definition. |
| `property.assign` | Add an existing property to a thread with an empty value. |
| `property.set` | Set a validated property value on a resolved thread. |
| `property.remove` | Remove a property assignment/value from a resolved thread. |
| `journal.takeNote` | Append a persona journal note only after approval. |

Command schemas are authoritative. The language specification does not duplicate every command's
arguments because registry-generated help must stay synchronized with implementation.

## 17. Canonical formatting

The formatter:

- uses two-space indentation,
- inserts one blank line between top-level declarations/actions,
- emits quoted strings unless a value is a safe symbol,
- preserves action order and mapping insertion order,
- normalizes multiline indentation and line endings,
- emits lowercase reserved literals,
- emits a final newline.

Formatting must be idempotent, and parsing formatted output must produce an equivalent AST.

## 18. Versioning

Persisted proposals record `languageVersion: 1`. Breaking grammar or semantic changes require a new
language version or an explicit migration. Registry command schemas may evolve compatibly, but a
stored proposal is always revalidated before execution and becomes stale if its meaning changes.

## 19. V1 acceptance criteria

- The parser accepts every normative example in this document.
- Invalid indentation, values, aliases, and references produce precise diagnostics.
- Parser/formatter round trips are stable.
- Unknown commands and arguments are rejected before proposal persistence.
- Embedded TQL remains read-only and resolves stable IDs.
- A valid script compiles without executing domain handlers.
- Every pending plan has an exact human-readable preview.
- No AI-callable path can confirm or execute a plan.
- Confirmation detects stale targets or versions and requires reapproval.
- Execution is idempotent across double clicks and reload recovery.
- The initial template/property workflow works end to end.
- The existing direct-write journal note tool is no longer available.
