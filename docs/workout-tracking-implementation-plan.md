# Workout tracking implementation plan

## 1. Product decision

Thread will support workout tracking through its existing notes, tasks, tags, properties, and
threads. A workout is an ordinary task subtree in a daily note:

```markdown
- [ ] #[workout] [[Push Day]]
  - [ ] #[exercise] [[Bench Press]]
    - [x] #[set] Set 1
    - [x] #[set] Set 2
    - [ ] #[set] Set 3
  - [ ] #[exercise] [[Overhead Press]]
    - [ ] #[set] Set 1
```

The editor may display canonical `#[workout]` as `#workout`; this document uses the bracketed form
when discussing storage because that is what the existing hashtag parser recognizes.

The existing task system owns status, hierarchy, completion, progress, dates, and general task
operations. The tag system tells the application what a task represents. Properties attached by tag
schemas store workout-specific values. A workout screen is only a specialized view of those blocks.

### Core invariants

1. Daily Markdown and its metadata envelope remain canonical.
2. Workout, exercise, and set blocks remain ordinary tasks.
3. `TaskRecord` remains general-purpose; workout measurements do not become task fields.
4. Workout measurements use existing block properties supplied by tag schemas.
5. The outline editor and workout UI edit the same source blocks and properties.
6. System behavior is resolved from stable tag IDs, not mutable tag names.
7. General task views show workout roots but hide exercise and set internals by default.
8. Derived workout views can always be rebuilt from existing tasks, tags, properties, and blocks.
9. The first release does not introduce workout templates, charts, TQL changes, or AI mutations.

## 2. YAGNI scope

The first release proves one loop:

> Create a workout in Today, add exercises and sets, record set properties, complete the task tree,
> and revisit the finished workout.

Do not build these until that loop works during real workouts:

- A custom set-expression language or parser.
- Workout-specific fields on `TaskRecord`.
- Canonical workout/session/exercise/set tables.
- Routine or program templates.
- Progress charts, volume analytics, or personal-record detection.
- Workout TQL sources or aggregation.
- AI workout mutation commands.
- Rest notifications, background timers, HealthKit, wearables, nutrition, or social features.
- A database migration solely for speculative performance indexes.

## 3. Reuse the existing data model

### 3.1 Keep `TaskRecord` unchanged

Do not add set measurements such as load, unit, reps, RPE, duration, or distance to `TaskRecord`.
They describe a set, not a task. Adding them would couple the global task projection to one domain,
enlarge every task record, and duplicate the property system already in the application.

Do not add `semanticRole` initially either. Resolve a task's workout role from its applied system tag
when assembling a workout view. If profiling later shows that join is too slow, a disposable
denormalized role index can be added without changing the source model.

### 3.2 Built-in system tags

Seed three definitions with stable IDs:

| Stable tag ID | Display name | Meaning |
|---|---|---|
| `system-workout` | workout | Workout task root |
| `system-exercise` | exercise | Exercise task inside a workout |
| `system-set` | set | Set task inside an exercise |

No new `TagDefinitionRecord` fields are required. A small registry is enough:

```ts
export const WORKOUT_SYSTEM_TAGS = {
  workout: 'system-workout',
  exercise: 'system-exercise',
  set: 'system-set',
} as const

export type WorkoutRole = keyof typeof WORKOUT_SYSTEM_TAGS
```

Add helpers:

```ts
workoutRoleFromTagIds(tagIds: readonly string[]): WorkoutRole | undefined
systemTagIdForWorkoutRole(role: WorkoutRole): string
isWorkoutSystemTag(tagId: string): boolean
```

Only one structural workout tag may apply to a block. Descriptive tags remain ordinary and
unrestricted, including `#[warmup]`, `#[drop]`, `#[failure]`, and user-created tags.

### 3.3 Tag schemas and block properties

Use built-in property definitions assigned to the system-tag schemas.

#### `#[workout]`

Start with only:

| Property ID | Type | Purpose |
|---|---|---|
| `workout-started-at` | datetime | Exact start time |
| `workout-finished-at` | datetime | Exact finish time |

Existing task date, status, description, and completion behavior cover everything else initially.

#### `#[exercise]`

No required custom properties. Its primary wiki-link supplies identity:

```markdown
- [ ] #[exercise] [[Bench Press]]
```

Notes remain ordinary child blocks or use the existing task description.

#### `#[set]`

Start with optional properties:

| Property ID | Type | Purpose |
|---|---|---|
| `set-load` | number | External load |
| `set-load-unit` | select | `kg` or `lb` |
| `set-reps` | number | Repetitions |
| `set-rpe` | number | Perceived exertion, 1–10 |
| `set-duration-seconds` | number | Timed-set duration |
| `set-distance` | number | Distance performed |
| `set-distance-unit` | select | `m`, `km`, or `mi` |

All are optional so the same schema covers strength, timed, and distance work. Validate in the set
editor:

- Measurements cannot be negative.
- Reps must be an integer.
- RPE must be between 1 and 10.
- Load requires a load unit.
- Distance requires a distance unit.

Do not add `set-mode`; infer the form layout from populated properties. Do not duplicate values into
task text. The title may remain `Set 1`, `Warm-up`, or any user description. The synced metadata
envelope already preserves properties.

### 3.4 Hierarchy and status

Expected hierarchy:

```text
#[workout] task
└── #[exercise] task
    └── #[set] task
```

Validation guides rather than rejects:

- An exercise should have a workout task ancestor.
- A set should have an exercise task ancestor.
- Plain notes, decisions, questions, images, and checklists may appear anywhere.
- Misplaced semantic tasks remain editable and receive a repair suggestion.

Resolve hierarchy through existing `parentTaskId` chains. Use current statuses unchanged:

| Status | Workout | Exercise | Set |
|---|---|---|---|
| `not_started` | Planned | Upcoming | Pending |
| `in_progress` | Active | Current | Being performed |
| `done` | Finished | Completed | Performed |
| `canceled` | Abandoned | Skipped | Skipped |
| `blocked` | Cannot train | Unavailable | Attempt prevented |

A failed set was attempted, so mark it `done` and optionally add `#[failure]`. Preserve current
parent progress behavior and cover workout trees with tests before changing ancestor logic.

## 4. Workout read model

Assemble a domain-shaped view at read time instead of persisting new workout records.

Create `src/lib/workouts/types.ts`:

```ts
export interface WorkoutSetView {
  task: TaskRecord
  properties: Map<string, PropertyValue>
  tags: BlockTagRecord[]
}

export interface WorkoutExerciseView {
  task: TaskRecord
  exerciseThread?: { id: string; title: string }
  sets: WorkoutSetView[]
  notes: OutlineBlock[]
}

export interface WorkoutView {
  task: TaskRecord
  properties: Map<string, PropertyValue>
  exercises: WorkoutExerciseView[]
  notes: OutlineBlock[]
  diagnostics: WorkoutDiagnostic[]
}
```

Create `src/lib/workouts/selectors.ts`:

- `getWorkoutRole(blockId)`
- `getWorkout(workoutTaskId)`
- `getWorkoutForBlock(blockId)`
- `getWorkoutsForDay(day)`
- `getActiveWorkout(day?)`
- `getRecentWorkouts(limit)`

For a workout, load the bounded data for its day: tasks, blocks, block tags, block properties, tag
definitions, and mentions. Resolve roles by fixed tag ID, walk task descendants, use the first
wiki-link as exercise identity, attach non-task notes, and report hierarchy/property diagnostics.
Only optimize this after profiling a realistically large day.

## 5. Built-in metadata initialization

### Step 1: declare built-ins

In `src/lib/blockMetadata.ts`:

- Add the minimal workout/set definitions to `BUILT_IN_PROPERTIES`.
- Add `BUILT_IN_TAGS` with the three fixed IDs and their property schemas.
- Keep tag constants in `src/lib/workouts/systemTags.ts` to centralize domain meaning.

The set tag contains all optional set property IDs. The workout tag contains start and finish. The
exercise tag starts with no properties.

### Step 2: seed in the correct order

In `initializeDatabase`:

1. Ensure built-in properties.
2. Ensure built-in workout tags.
3. Reindex days.

This ensures an existing inline `#[workout]` resolves to `system-workout` instead of creating a
second ordinary tag.

### Step 3: collisions and protection

If an ordinary tag already uses a reserved display name, preserve it, create the protected stable
ID, prefer the protected tag for canonical inline resolution, and surface the collision in Settings.
Do not silently overwrite user schemas.

Update tag operations:

- Reject deletion or renaming of protected IDs.
- Remove another structural workout tag before applying a new one.
- Applying a structural tag to a non-task converts it to a task.
- Removing a structural tag leaves it as an ordinary task.

No Dexie migration is required because existing tables and indexes hold everything needed.

## 6. Workout mutations

Create `src/lib/workouts/mutations.ts`:

```ts
createWorkout(input: { day?: string; title?: string }): Promise<string>
addExercise(workoutTaskId: string, exerciseTitle: string): Promise<string>
addSet(exerciseTaskId: string): Promise<string>
updateSet(setTaskId: string, values: SetPropertyInput): Promise<void>
duplicateSet(setTaskId: string): Promise<string>
skipSet(setTaskId: string): Promise<void>
skipExercise(exerciseTaskId: string): Promise<void>
deleteWorkoutItem(taskId: string): Promise<void>
```

- `createWorkout` appends a task and applies `system-workout`.
- `addExercise` inserts a child task containing `#[exercise] [[Title]]`.
- `addSet` inserts a child task containing `#[set] Set N`.
- `updateSet` validates and writes block properties without rewriting its title.
- `duplicateSet` duplicates the task and copies set properties and descriptive tags.
- Skipping uses existing task status operations.
- Deletion uses existing subtree deletion behavior.

Creating a task and then tagging it currently takes separate writes. Add only the smallest helper
needed to insert a task/subtask with initial metadata in one queued day write. Do not create a new
general transaction framework.

## 7. Workout lifecycle

Create `src/lib/workouts/lifecycle.ts`.

### Start

`startWorkout` verifies the tag, reports another active workout as a typed UI conflict, sets the root
to `in_progress`, and writes `workout-started-at` only when absent.

### Complete a set

`completeSet` validates properties, marks the existing set task done through `setTaskStatus`, lets
current parent-progress derivation run, and returns the next pending set ID for UI focus. Existing
`TaskRecord.completedAt` is sufficient initially.

### Finish

`finishWorkout` finds unresolved sets, requires the UI to choose whether to cancel or leave them
pending, marks the workout done manually, and writes `workout-finished-at`.

Canceling changes only the workout root unless the user explicitly cancels unresolved descendants.
Reopening clears finish time, returns the root to in progress, and preserves completed sets. All
lifecycle operations must be safe to retry.

## 8. Editor integration

Add slash commands:

- `/workout`: task + `#[workout]`.
- `/exercise`: task + `#[exercise]`.
- `/set`: task + `#[set]`.

Do not add these to `BlockConversionKind`; they are semantic tag actions on task blocks. Extend the
slash-command union with a discriminated `semantic-task` action.

In outline mode:

- Render structural tags as compact chips/icons.
- Preserve canonical inline tags in source mode.
- Show “Open workout” on workout roots.
- Show existing derived progress on workout and exercise tasks.
- Keep ordinary descriptive tags visible.
- Show quiet invalid-hierarchy warnings.

Keep existing task controls in the inspector and add role-specific sections:

- Workout: start/finish time and open-workout action.
- Exercise: exercise thread and descendant-set summary.
- Set: load, unit, reps, RPE, duration, distance, and distance unit.

The set inspector uses existing property mutators through a compact form.

## 9. Workout lens

Create:

```text
src/pages/WorkoutPage.tsx
src/components/workouts/WorkoutHeader.tsx
src/components/workouts/ExerciseCard.tsx
src/components/workouts/SetRow.tsx
src/components/workouts/SetEditor.tsx
src/components/workouts/WorkoutDiagnostics.tsx
```

Register `/workout/:day/:blockId`. It selects an existing task subtree; it does not create a workout
record.

### Workout header

- Title/thread link.
- Planned, active, completed, or canceled state.
- Completed/actionable set count.
- Start and finish actions.
- Exact source-block link.
- Elapsed time calculated from start/finish properties; pause behavior is deferred.

### Exercise card

- Exercise name/thread link.
- Completed/actionable set count.
- Add set, skip, reorder, and delete.
- Ordinary child notes.

Substitution, supersets, and previous-performance suggestions are deferred.

### Set row

- Existing task status control.
- Property inputs appropriate to populated measurements.
- Save and complete actions.
- Duplicate, skip, and delete.
- Source-block link.

Do not build a textual set parser. Values are edited as block properties.

### Mobile and accessibility

- Support 320 CSS-pixel width without horizontal scrolling.
- Use numeric mobile keyboards.
- Keep completion targets at least 44 by 44 CSS pixels.
- Keep active inputs visible above the software keyboard.
- Provide button alternatives for drag/swipe.
- Announce validation and status changes without moving focus unexpectedly.

## 10. Existing-surface integration

### Today

- Detect today's workout roots.
- Show Open/Resume actions.
- Add a New workout action.
- Keep the editor as the canonical authoring surface.

### Tasks

- Show workout roots.
- Hide exercise and set tasks by default.
- Add an `Include workout internals` advanced filter.
- Show workout progress and Open/Resume on workout rows.
- Apply the same visibility policy to counts.

### Exercise threads

The exercise wiki-link already creates a thread and occurrence. Add a small “Workout occurrences”
section to `ThreadPage`, grouped by day, showing child set count and exercise completion. Charts,
records, and trends remain deferred.

### Search

Do not change the search index initially. Existing text, tags, and wiki-links remain searchable.
Ensure results within a workout can reveal their source and offer the workout lens.

## 11. AI coach integration

Keep the first release read-only for the coach. When a workout is active or open, assemble a bounded
AI payload from the workout view containing workout/exercise/set IDs, titles, statuses, and the set
property values. This payload is not persisted and does not extend `TaskRecord`.

Update the AI feature guide to explain that workouts are tagged task subtrees, measurements are block
properties, task status represents lifecycle, and workout mutations are not available. Do not add
ThreadScript workout commands until the trusted UI workflow has shipped and stabilized.

## 12. Code change map

### New files

| File | Responsibility |
|---|---|
| `src/lib/workouts/systemTags.ts` | Stable IDs and role helpers. |
| `src/lib/workouts/types.ts` | Read-time workout view types and diagnostics. |
| `src/lib/workouts/selectors.ts` | Assemble workout trees from existing tables. |
| `src/lib/workouts/mutations.ts` | Create/edit task subtrees and set properties. |
| `src/lib/workouts/lifecycle.ts` | Start, complete, finish, cancel, and reopen. |
| `src/lib/workouts/*.test.ts` | Domain tests. |
| `src/pages/WorkoutPage.tsx` | Specialized lens over a workout subtree. |
| `src/components/workouts/*` | Workout header, exercises, sets, editor, diagnostics. |

### Existing files

| File | Required change |
|---|---|
| `src/lib/blockMetadata.ts` | Add built-in workout properties and tags. |
| `src/db.ts` | Seed built-in tags before reindexing and protect stable IDs; leave `TaskRecord` unchanged. |
| `src/lib/hashtags.ts` | Prefer protected IDs for reserved workout names. |
| `src/lib/tasks.ts` | Add the minimal atomic tagged-subtask insertion helper. |
| `src/lib/suggestions.ts` | Add semantic task slash commands. |
| `src/components/MarkdownEditor.tsx` | Apply semantic tags and render role affordances. |
| `src/components/ContextualInspector.tsx` | Dispatch to role-specific sections. |
| `src/components/inspector/TaskDraft.tsx` | Add compact property editors. |
| `src/pages/TodayPage.tsx` | Add New/Open/Resume workout actions. |
| `src/pages/TasksPage.tsx` | Hide internals by default and render workout roots. |
| `src/components/TaskRow.tsx` | Add workout-root progress/action treatment. |
| `src/pages/ThreadPage.tsx` | Add basic exercise workout occurrences. |
| `src/App.tsx` and tab routing | Register workout lens. |
| `src/lib/aiContext.ts` | Add bounded read-only active-workout context. |
| `src/styles/features.css` | Add workout/mobile/accessibility styles. |
| `docs/ux-regression-checklist.md` | Add workout workflow gates. |
| `README.md` | Document the feature after it ships. |

Intentionally unchanged initially:

- `src/lib/query/*`
- `src/pages/TemplatesPage.tsx`
- `src/lib/commands/templateCommands.ts`
- ThreadScript command files
- Dexie store definitions and indexes

## 13. Implementation phases

### Phase 1: tags and schemas

1. Add system-tag constants.
2. Add minimal property definitions and tag schemas.
3. Seed tags before day reindexing.
4. Resolve reserved names to stable IDs.
5. Protect tags from deletion/renaming.
6. Test collisions and idempotency.

Exit: handwritten tagged task trees survive reload and serialization correctly.

### Phase 2: selectors and authoring

1. Build workout role/tree selectors.
2. Add hierarchy/property diagnostics.
3. Add the three slash commands.
4. Add atomic tagged task/subtask insertion.
5. Add outline decorations and Open workout.

Exit: a user can create a workout tree in Today and selectors return the correct structure.

### Phase 3: mutations and lifecycle

1. Implement create/add/update/duplicate/skip/delete.
2. Implement start, complete set, finish, cancel, and reopen.
3. Verify existing parent progress.
4. Test manual overrides, canceled sets, malformed hierarchy, and retries.

Exit: domain functions operate a complete workout without UI-specific writes.

### Phase 4: workout lens

1. Add route/source return.
2. Build header, exercise cards, and set editor.
3. Add role-specific inspector content.
4. Complete validation, keyboard, mobile, and accessibility behavior.
5. Test live agreement with outline edits.

Exit: a phone user can log, finish, reload, and revisit a workout.

### Phase 5: integration

1. Add Today entry points.
2. Filter workout internals from general Tasks.
3. Add workout-root row treatment.
4. Add exercise occurrence history.
5. Add bounded read-only coach context.
6. Update documentation and release QA.

Exit: workouts feel native without degrading ordinary notes, tasks, threads, or search.

## 14. Testing plan

### Unit and database

- Stable tag/role resolution and reserved-name collisions.
- Set property validation.
- Workout tree construction with intervening non-task notes.
- Missing exercise link and malformed hierarchy diagnostics.
- Status propagation with completed, canceled, and manually overridden parents.
- Initialization idempotency and preservation of existing tags.
- Protected-tag mutation rules.
- Inline tag resolution to protected IDs.
- Duplication preserves set properties and descriptive tags.
- GitHub day serialization/conflict handling preserves workout properties.
- Three identical sibling sets preserve correct metadata when edited, completed, and reordered.

The identical-set test is a release blocker. If current identity reconciliation fails, strengthen
general block identity before shipping; do not add workout-only identity machinery.

### Component and end-to-end

- Slash commands create correctly tagged tasks.
- Workout lens reflects outline/property changes.
- Set completion updates parent progress.
- Validation is visible and announced.
- Tasks hides internals by default and reveals them through its filter.
- Every workout projection links to its exact source.
- Create, log, finish, reload, and revisit a workout.
- Reload during an active workout.
- Log offline, reconnect, and sync.
- Skip sets/exercises and verify progress.
- Complete the flow using keyboard, touch, and screen reader.

## 15. Release gates

- Existing tests, lint, and production build pass.
- Existing notes, tasks, tags, schemas, and sync remain compatible.
- `TaskRecord` has no workout fields and there are no canonical workout tables.
- No database migration exists without measured need.
- Workout properties survive reload, export, sync, pull, and conflict resolution.
- General Tasks counts are not inflated by exercise/set internals.
- Outline and workout lens agree because they share the same source.
- The core flow works at 320 CSS pixels without a hardware keyboard.
- Primary controls meet accessibility and touch-target requirements.
- The coach cannot mutate workout data in the first release.

## 16. Evidence-driven follow-ups

After real use, add only what evidence supports:

- If property entry is too slow, consider typed set shorthand.
- If tag/property joins are slow, add disposable indexes.
- If repeated structures are a real pain point, then design workout templates.
- If users need comparisons, add exercise-history summaries.
- If summaries are trustworthy, add volume, records, and charts.
- If UI mutations are stable, expose them through confirmed ThreadScript actions.
  **Delivered:** a `workout.*` ThreadScript command family (`buildDay`, `addExercises`,
  `updateExercise`, `removeExercise`, `start`, `logSet`, `finish`) and a built-in **Workout Coach**
  persona that interviews the user into a "Training Plan" thread and proposes sessions from it. This
  supersedes the §11 / §15 gate "the coach cannot mutate workout data in the first release" — the
  coach mutates only through user-confirmed proposals, and everything still resolves against the
  canonical task/tag/property model.
- If timing is valuable, add pause metadata and a rest timer.

Every follow-up should retain the canonical task/tag/property model.
