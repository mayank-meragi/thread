# ThreadScript capability inventory

Status: baseline for ThreadScript v1 planning  
Last reviewed: 2026-09-01

This document inventories the operations a person can currently perform in Thread and classifies
how an AI assistant may reach the same outcome. It is the coverage checklist for the shared command
registry: an operation is not AI-capable merely because the model knows that it exists; it is
AI-capable only after it has a registered, validated, previewable command or an explicitly read-only
resource.

Language syntax and execution semantics are defined in the
[ThreadScript v1 specification](threadscript-spec.md).

## Classification

| Class | Meaning | AI policy |
|---|---|---|
| Read | Observe or search application state without changing it. | May run without confirmation. Results must omit secrets. |
| Content write | Change user-authored or user-organized data. | Must be proposed and confirmed. |
| Workspace | Change transient/local presentation state such as the active tab or layout. | Must be proposed and confirmed under the initial policy. |
| External | Contact a provider, sync, import, export, or otherwise affect a system outside the local database. | Must be proposed and confirmed with destination and scope. |
| Destructive | Delete, archive, replace, disconnect, or perform a broad change that is difficult to undo. | Must be proposed with a stronger warning and exact affected targets. |
| Internal | Indexing, migrations, sync bookkeeping, and other implementation details. | Never exposed as ThreadScript actions. Invoked only by trusted commands. |

Creating a pending chat proposal is not a domain action. It may persist the proposed script and
preview so the user can review it, but it must not change notes, settings, workspace state, or an
external system.

## Coverage states

- **Slice 1**: required for the first end-to-end ThreadScript release.
- **Later**: part of the full-parity roadmap after Slice 1 is stable.
- **Read model**: exposed through compact application context or read-only TQL/resource inspection.
- **Internal only**: intentionally unavailable to the model.

## Daily journal and editor

| User outcome | Class | Proposed capability/resource | Coverage | Current implementation |
|---|---|---|---|---|
| Open Today or another journal date | Workspace | `view.openDay` | Later | `TodayPage`, route query parameters |
| Read a day's Markdown and indexed blocks | Read | day/block resources; read-only TQL extension | Later | `db.days`, `db.blocks` |
| Replace a day's journal content through the editor | Content write | `day.content.replace` | Later | `saveDay` |
| Append captured text to a day | Content write | `day.content.append` | Later | compiled to `saveDay` |
| Insert, edit, or remove an outline block | Content write / destructive | `block.create`, `block.update`, `block.delete` | Later | `MarkdownEditor`, `saveDay` |
| Indent, outdent, or move a block/subtree | Content write | `block.indent`, `block.outdent`, `block.move` | Later | editor transactions |
| Change block kind such as task, decision, idea, or question | Content write | `block.setKind` | Later | block-kind plugins/editor commands |
| Toggle a checklist item | Content write | `block.toggleChecklist` | Later | `toggleChecklistBlock` |
| Add Markdown formatting, links, wikilinks, or code | Content write | structured block/content commands | Later | `MarkdownEditor` |
| Navigate to a linked thread or source block | Workspace | `view.openThread`, `view.openBlock` | Later | routes and inspector links |

ThreadScript should operate on semantic blocks and Markdown, not simulated keystrokes. Editor-only
undo/redo and cursor movement remain direct UI interactions unless Thread later exposes a stable
editor transaction service.

## Threads and thread notes

| User outcome | Class | Proposed capability/resource | Coverage | Current implementation |
|---|---|---|---|---|
| List, search, and inspect threads | Read | thread resource; `inspectTql` over `threads` | Read model | `db.threads`, TQL sources, search |
| Create a thread | Content write | `thread.create` | Slice 1 | `createThread` |
| Rename a thread | Content write | `thread.rename` | Slice 1 | `renameThread` |
| Read a thread's note, properties, occurrences, tasks, and projections | Read | thread detail resource | Read model | `ThreadPage`, `db.threadNotes`, indexes |
| Replace thread-note content | Destructive | `thread.content.replace` | Slice 1 | `saveThreadNote` |
| Append to thread-note content | Content write | `thread.content.append` | Slice 1 | compiled to `saveThreadNote` |
| Open a thread | Workspace | `view.openThread` | Later | router/dockview |
| Change thread task display between list, compact, and board | Workspace | `view.setThreadTaskDisplay` | Later | `ThreadPage` local state |
| Collapse or expand a projected outline item | Workspace | `view.setBlockCollapsed` | Later | `db.viewState` |
| Prune orphaned derived threads | Internal | none | Internal only | `pruneOrphanThreads` |

Thread IDs are stable targets. Titles may be used in scripts for convenience, but proposal
resolution must reject ambiguity and store the resolved ID.

## Templates

| User outcome | Class | Proposed capability/resource | Coverage | Current implementation |
|---|---|---|---|---|
| List and inspect templates | Read | template resource; thread query filtered by `isTemplate` | Read model | `TemplatesPage`, `db.threads` |
| Mark or unmark a thread as a template | Content write | `template.enable`, `template.disable` | Slice 1 | `setThreadIsTemplate` |
| Create a template with content and properties | Content write | `template.create` | Slice 1 | composed thread/property operations |
| Apply a template to a thread | Content write | `template.apply` | Slice 1 | `applyThreadTemplate` |
| Edit template content or properties | Content write | thread/property commands targeting a template | Slice 1 | normal thread editor and properties |

`template.create` is a convenience command, not a separate storage model. A template remains a
thread with `isTemplate` set.

## Property definitions and values

| User outcome | Class | Proposed capability/resource | Coverage | Current implementation |
|---|---|---|---|---|
| List property definitions and options | Read | property-definition resource | Read model | `db.propertyDefinitions` |
| Ask AI to suggest useful properties | Read/advice | ordinary assistant response, optionally grounded by resources | Slice 1 | new AI context behavior |
| Create a property definition | Content write | `property.create` | Slice 1 | `createPropertyDefinition` |
| Rename or configure a definition's options/default/required state | Content write | `property.updateDefinition` | Later | `updatePropertyDefinition` |
| Assign a property to a thread with an empty value | Content write | `property.assign` | Slice 1 | `setThreadProperty(..., null)` |
| Set or clear a thread property value | Content write | `property.set`, `property.remove` | Slice 1 | `setThreadProperty`, `removeThreadProperty` |
| Set or clear a block property value | Content write | `blockProperty.set`, `blockProperty.remove` | Later | `setBlockProperty`, `removeBlockProperty` |
| Edit a thread property through an editable TQL result | Content write | compiled to `property.set`/`property.remove` | Later | `QueryBlock` |

Suggestion is not execution: the assistant may recommend a schema in prose without confirmation,
but creating, assigning, or changing it always requires an approved proposal.

## Tasks and checklists

| User outcome | Class | Proposed capability/resource | Coverage | Current implementation |
|---|---|---|---|---|
| List, filter, sort, and inspect tasks | Read | task resource/read-only query | Later | `TasksPage`, `db.tasks` |
| Create a task or subtask | Content write | `task.create`, `task.createSubtask` | Later | `createTask`, `createSubtask` |
| Rename or describe a task | Content write | `task.rename`, `task.setDescription` | Later | task helpers |
| Set status, due date, start date, priority, or estimate | Content write | `task.setStatus`, `task.setDueDate`, `task.setStartDate`, `task.setPriority`, `task.setEstimate` | Later | `src/lib/tasks.ts` |
| Complete a task and optionally its children | Content write | `task.setStatus` with explicit child policy | Later | `setTaskStatus` |
| Duplicate a task | Content write | `task.duplicate` | Later | `duplicateTask` |
| Indent, outdent, move up, or move down | Content write | `task.indent`, `task.outdent`, `task.move` | Later | task helpers |
| Delete a task or task subtree | Destructive | `task.delete` | Later | `deleteTask` |
| Bulk update status, due date, or priority | Content write | bulk targets on the same task commands | Later | bulk task helpers |
| Change task page view, filters, sort, or display mode | Workspace | `view.setTaskView` | Later | route parameters/local UI state |

Bulk commands must resolve and preview the exact task IDs before approval. A changed result set
requires a new preview and approval.

## Tags and metadata schemas

| User outcome | Class | Proposed capability/resource | Coverage | Current implementation |
|---|---|---|---|---|
| List tags, usage, colors, and schemas | Read | tag/schema resource; TQL `tags` source | Read model | `db.tagDefinitions`, TQL |
| Create a tag/schema | Content write | `tag.create` | Later | `createTag` |
| Rename a tag, set its color, fields, required fields, or defaults | Content write | `tag.update` | Later | `updateTagDefinition` |
| Apply or remove a tag on a block | Content write | `tag.apply`, `tag.remove` | Later | `addBlockTag`, `removeBlockTag` |
| Delete a tag definition and remove it from blocks | Destructive | `tag.delete` | Later | `deleteTagDefinition` |

## Workouts and training plans

Workouts are ordinary `#[workout]` / `#[exercise]` / `#[set]` tagged task subtrees; the `workout.*`
commands are convenience orchestrations over `src/lib/workouts/mutations.ts` + `lifecycle.ts`, not a
new storage shape. Because workout/exercise/set task IDs are non-deterministic, every command
resolves its target by natural key (day + optional workout title; exercise by name; set by 1-based
number) and previews against a synthetic `kind: 'workout'` target.

| User outcome | Class | Proposed capability/resource | Coverage | Current implementation |
|---|---|---|---|---|
| Read the coaching training plan and recent sessions | Read | `context.trainingPlan`, `context.recentWorkouts` application context | Read model | `src/lib/aiContext.ts`, `getRecentWorkouts` |
| Create a whole day's workout (root, exercises, measured sets) | Content write | `workout.buildDay` | Slice: workout-coach | `createWorkout` + `addExercise` + `addSet` + `updateSet` |
| Add exercises to an existing day's workout | Content write | `workout.addExercises` | Slice: workout-coach | `addExercise` + `addSet` + `updateSet` |
| Rebuild one exercise's set list (update / add / skip) | Destructive | `workout.updateExercise` | Slice: workout-coach | `updateSet` / `addSet` / `skipSet` |
| Remove an exercise and its sets | Destructive | `workout.removeExercise` | Slice: workout-coach | `deleteWorkoutItem` |
| Start a day's workout | Content write | `workout.start` | Slice: workout-coach | `startWorkout` |
| Record and complete one performed set | Content write | `workout.logSet` | Slice: workout-coach | `updateSet` + `completeSet` |
| Finish a day's workout | Content write | `workout.finish` | Slice: workout-coach | `finishWorkout` |
| Create / update the "Training Plan" thread | Content write | reuses `thread.create`, `thread.content.append`, `thread.content.replace` | Slice 1 | thread commands |
| Mutate an existing workout outside these commands | — | none (direct interaction) | Direct only | the workout lens (`/workout/:day/:blockId`) |

## TQL, search, and documentation

| User outcome | Class | Proposed capability/resource | Coverage | Current implementation |
|---|---|---|---|---|
| Search notes and threads | Read | search resource | Read model | `SearchPage`, `searchDays`, Omnibox |
| Run a TQL query over threads or tags | Read | `inspectTql` | Slice 1 | query parser/evaluator/sources |
| Add or edit a live TQL block in a note | Content write | normal content/block commands | Later | `QueryBlock`, Markdown editor |
| Hide or show a query block's source | Workspace | `view.setQuerySourceVisible` | Later | `QueryBlock` local preference |
| Read Thread documentation or ThreadScript help | Read | documentation/help resource | Slice 1 | docs pages plus command registry metadata |

Existing TQL remains read-only as a language. Its `EDITABLE` clause is a UI projection whose edits
must compile to property commands; it does not make TQL itself a write language.

## Workspace, navigation, and inspector

| User outcome | Class | Proposed capability/resource | Coverage | Current implementation |
|---|---|---|---|---|
| Open Today, Tasks, Search, Settings, Templates, Docs, or a thread | Workspace | `view.open` plus typed convenience actions | Later | React Router/dockview |
| Open a route in a new/background tab | Workspace | `tab.open` | Later | `TabsApiProvider` |
| Activate or close a tab | Workspace | `tab.activate`, `tab.close` | Later | dockview |
| Split a tab right/below or move it to another group | Workspace | `tab.split`, `tab.moveToNextGroup` | Later | dockview actions |
| Show or hide the activity bar, context rail, or chat panel | Workspace | `workspace.setPanelVisibility` | Later | local preferences/dockview events |
| Open or close task/block details | Workspace | `inspector.open`, `inspector.close` | Later | inspector target events |
| Switch personas or chat sessions | Workspace | `chat.selectPersona`, `chat.selectSession` | Later | chat UI/local preferences |

The initial policy asks for confirmation even for AI-originated workspace changes. A future user
setting may grant a session-scoped permission for low-risk navigation, but the model must never be
able to grant that permission itself.

## AI chat, personas, and sessions

| User outcome | Class | Proposed capability/resource | Coverage | Current implementation |
|---|---|---|---|---|
| Read persona names, prompts, and session metadata | Read | persona/session resources, excluding provider secrets | Later | `db.personas`, `db.chatSessions` |
| Create or edit a persona | Content write | `persona.create`, `persona.update` | Later | persona helpers |
| Generate persona fields using AI | External | `persona.generateDraft` | Later | `personaBuilder` |
| Archive a persona | Destructive | `persona.archive` | Later | `archivePersona` |
| Create or rename a chat session | Content write | `chat.createSession`, `chat.renameSession` | Later | persona/session helpers |
| Delete a chat session | Destructive | `chat.deleteSession` | Later | `deleteSession` |
| Record a persona journal note | Content write | `journal.takeNote` | Slice 1 | currently `appendPersonaJournalNote` |
| Send a chat message | External | direct user interaction, not a self-issued ThreadScript action | Not applicable | `ChatPanel`/AI provider |

The existing automatic `takeNote` AI tool must be removed or converted to an approval-gated
ThreadScript command before the new mutation system is enabled.

## Settings, appearance, sync, and conflicts

| User outcome | Class | Proposed capability/resource | Coverage | Current implementation |
|---|---|---|---|---|
| Read non-secret settings and sync status | Read | settings/sync status resources | Later | settings helpers, outbox/conflicts |
| Change theme | Workspace | `settings.setTheme` | Later | `applyTheme` |
| Configure AI provider/model | External/configuration | `settings.configureAI` with user-entered secret field | Later | AI config helpers |
| Disconnect the AI provider | Destructive | `settings.disconnectAI` | Later | `clearAIConfig` |
| Configure or reconnect GitHub sync | External/configuration | `sync.configure` with user-entered secret field | Later | GitHub config helpers |
| Sync pending changes | External | `sync.pushPending` | Later | `syncPending` |
| Pull the latest day or thread note | External / potentially overwriting | `sync.pullDay`, `sync.pullThread` | Later | GitHub helpers |
| Resolve a sync conflict using local, remote, or per-hunk choices | Destructive/external | `sync.resolveConflict` | Later | `resolveConflict` |
| Disconnect GitHub | Destructive | `sync.disconnect` | Later | `clearGitHubConfig` |
| Upload an editor asset to the data repository | External | `asset.upload` | Later | `uploadRepoAsset` |

API keys and GitHub tokens are never readable resources and must never appear in model context,
ThreadScript source, stored previews, logs, or command results. Commands that require a secret must
render a trusted user-only input during confirmation.

## Internal-only operations

The following are implementation mechanics, not capabilities:

- Database initialization and migrations.
- Markdown parsing, block identity reconciliation, and derived indexing.
- Outbox creation and sync revision bookkeeping.
- Applying remote records and merged documents.
- Conflict record creation.
- Persona-thread repair.
- Cache, layout, and MRU maintenance.
- Dispatching local-write and inspector events from a command handler.

ThreadScript commands may cause these operations indirectly through existing domain functions, but
the model cannot name or invoke them.

## Slice 1 acceptance checklist

- [x] AI context explains threads, templates, properties, TQL, ThreadScript, and approval behavior.
- [x] AI can read relevant thread, template, and property-definition state without receiving secrets.
- [x] AI can suggest properties in prose without creating a proposal.
- [x] `thread.create`, `thread.rename`, `thread.content.append`, and `thread.content.replace` are registered.
- [x] `template.create`, `template.enable`, `template.disable`, and `template.apply` are registered.
- [x] `property.create`, `property.assign`, `property.set`, and `property.remove` are registered.
- [ ] `journal.takeNote` is registered and the direct-write AI tool is gone.
- [ ] Every registered write produces a dry-run preview before approval.
- [ ] Cancelling performs no domain write.
- [ ] Confirmation revalidates the approved targets and executes idempotently.
- [ ] Pending and completed proposals survive chat/session reloads.

## Full-parity completion rule

ThreadScript reaches full app parity when every current user operation in this inventory is either:

1. represented by a tested read-only resource/query,
2. represented by a tested registered command with preview and approval semantics, or
3. explicitly documented as a direct interaction that is unsafe or meaningless to automate.

New UI features must update this inventory and declare their resource or command before they are
considered AI-capable.
