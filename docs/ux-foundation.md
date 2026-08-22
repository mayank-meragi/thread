# Thread UX foundation

This document defines the workflows and measurable UX baseline for Thread's redesign. It is the
source of truth for what the product must make easy; the reusable release gate lives in
[`ux-regression-checklist.md`](./ux-regression-checklist.md).

Baseline captured: 2026-08-22 at `c866c8b`.

## The five core jobs

| Job | User intent | Successful outcome | Failure signal |
|---|---|---|---|
| Capture | Get a thought out without first organizing it | The text is visible in Today and committed locally without interrupting typing | The user must choose a destination, wait for sync, or wonder whether the text saved |
| Structure | Turn rough notes into an outline, task, subtask, tag, or linked thread | Structure can be added in place without rewriting or relocating the source text | Structure requires leaving the writing surface or changes canonical text unexpectedly |
| Retrieve | Find a remembered phrase, thread, task, or day | A local search reaches the exact source and preserves enough context to recognize it | A match cannot be opened, results lag behind local writes, or remote access is required |
| Act | Decide what to do next and update its state | The task can be found, understood in context, and progressed with immediate feedback | Task state differs between the task view and source outline, or an action lacks confirmation |
| Revisit context | Resume a topic with its history and provenance intact | A thread shows direction, open work, decisions, and source-linked notes | Synthesis hides its source, duplicates history, or strands the user away from Today |

The shared product loop is **capture -> structure -> retrieve -> act -> revisit**. A release may
improve one job, but must not regress another.

## Measurement conventions

- Start state is a loaded app on Today unless a workflow says otherwise.
- An **interaction** is a click, tap, shortcut, or non-text keypress. Typing a value is recorded as
  one text-entry step regardless of character count.
- Completion means the result is visible and survives a reload from IndexedDB. GitHub replication
  is measured separately because it must not block a local workflow.
- Desktop reference viewport: 1440 x 900 with keyboard and pointer.
- Mobile reference viewport: 390 x 844 with touch-sized controls and the software keyboard.
- Run timed checks five times against a populated local database. Report median, p75, and worst
  result; release thresholds apply at p75 unless explicitly marked as a maximum.
- Test cold startup after clearing the HTTP cache and warm startup with persisted local data. Do
  not clear IndexedDB between warm runs.

## Critical paths and interaction baseline

Counts describe the current shortest discoverable path. They are not aspirational targets.

| Outcome | Desktop path | Desktop baseline | Mobile path | Mobile baseline |
|---|---|---:|---|---:|
| Capture a note | Focus Today's editor -> type -> `Enter` | 2 interactions + text | Tap Today's editor -> type -> return | 2 interactions + text |
| Create a task | Tasks -> focus quick add -> type -> `Enter` | 3 interactions + text | Tasks in bottom nav -> focus quick add -> type -> Add | 3 interactions + text |
| Create a subtask | Tasks -> open parent -> focus “Add a subtask” -> type -> `Enter` | 4 interactions + text | Same path; details open as a bottom sheet | 4 interactions + text |
| Add an inline tag | Focus editor -> type `#name` -> choose/create suggestion | 2 interactions + text | Focus editor -> type `#name` -> tap suggestion | 2 interactions + text |
| Add a wikilink | Focus editor -> type `[[name` -> choose/create suggestion | 2 interactions + text | Focus editor -> Link toolbar action -> type name -> choose/create suggestion | 3 interactions + text |
| Nest a new block | `Enter` -> `Tab` | 2 interactions | Return -> Indent toolbar action | 2 interactions |
| Find a journal phrase | `Cmd/Ctrl+K` -> type query | 1 interaction + text, but incomplete | Search in bottom nav -> type query | 2 interactions + text, but incomplete |
| Complete a due-today task | Click its checkbox in Today's task section | 1 interaction | Tap its checkbox in Today's task section | 1 interaction |
| Resume a recent thread | Click a recent thread in the sidebar | 1 interaction | Search -> tap a recent thread | 2 interactions |
| Return from a thread to source | Open a source row | 1 interaction | Open a source row | 1 interaction |

“Find a journal phrase” is incomplete because current journal result rows are not links and cannot
open the matching day/block. This is a known baseline defect, not an accepted redesign behavior.

### Capture

Expected outcome:

1. Today opens to the current day.
2. The user can enter text immediately; the redesign target is no focus action on desktop.
3. `Enter` creates a sibling; `Tab`/`Shift+Tab` changes depth.
4. The change is reflected in the day, block index, thread projections, and task index as relevant.
5. Local persistence happens before background GitHub replication.

Mobile must expose keyboard-independent controls for indent, outdent, block kind, and wikilink.
The current mobile outline toolbar supplies these controls while the editor is focused.

### Structure

Expected outcome:

- A task created from Tasks is also a canonical block in today's journal.
- A subtask is nested below its parent in both the source outline and task tree.
- `#name` suggests existing tags and can create a new tag; committed Markdown is `#[name]`.
- `[[name]]` creates or links a thread and round-trips as canonical wikilink syntax.
- Structure changes preserve block identity, undo behavior, and source text.

On mobile, due date and priority are intentionally absent from quick add at 390 px. They remain
available after opening task details; verify that this second-stage path stays discoverable.

### Retrieve

Expected outcome:

- `Cmd/Ctrl+K` focuses Search on desktop; Search is a persistent bottom-nav destination on mobile.
- Results include the matching excerpt, day, and a control that opens the exact source block.
- Search reflects the latest committed local edit and works offline.
- Empty, loading, zero-result, and large-result states are announced and remain keyboard reachable.

### Act

Expected outcome:

- A status change gives immediate visual acknowledgement and persists locally.
- Parent progress is recomputed when a subtask changes.
- Task filters, counts, Today, thread projections, and source blocks agree after a change.
- Bulk actions expose the affected count and do not silently drop hidden descendants.

### Revisit context

Expected outcome:

- A thread exposes current direction, source outline, open questions, tasks, decisions, recent
  thoughts, and ideas without moving canonical blocks.
- Every projected item opens its source day/block.
- Desktop offers recent threads in the sidebar; mobile reaches recent threads through Search.
- Back/forward, app tabs, and Today preserve the user's place.

## Performance baseline and release budgets

The observed startup sample below is a warm local development measurement, not a production claim.
It starts immediately before reload and ends when the first element labelled “Daily journal editor”
is visible. Vite served the app locally; IndexedDB and the demo content were already populated.

| Environment | Runs (ms) | Median | Range |
|---|---|---:|---:|
| Desktop, default browser viewport | 471, 474, 459, 491, 470 | 470 ms | 459–491 ms |
| Mobile, 390 x 844 | 607, 481, 465, 482, 469 | 481 ms | 465–607 ms |

The visibility marker is repeatable but weaker than true input readiness. Add an `editor-ready`
performance mark before using this number for trend analysis.

| Measure | Operational definition | Desktop budget | Mobile budget |
|---|---|---:|---:|
| App shell startup | Navigation start to usable primary navigation | <= 1,000 ms | <= 1,500 ms |
| Editor startup | Navigation start to focused editor accepting input; test cold and warm separately | <= 1,200 ms | <= 1,800 ms |
| Typing latency | Keydown to next painted editor state, p75 over a 200-character burst | <= 75 ms | <= 100 ms |
| Typing worst case | Maximum keydown-to-paint in the same burst | <= 150 ms | <= 200 ms |
| Search response | Query change to stable results for 10,000 blocks | <= 100 ms | <= 150 ms |
| Task acknowledgement | Status action to visible state change | <= 100 ms | <= 100 ms |
| Task persistence | Status action to completed IndexedDB transaction | <= 250 ms | <= 250 ms |
| Local workflow availability | Capture/search/task completion while offline | 100% | 100% |

GitHub sync is not part of the interaction budgets. Record time-to-replication separately and fail a
release if sync work causes typing, search, or task acknowledgement to exceed these budgets.

## Accessibility baseline

All five jobs must complete under each applicable mode:

- Keyboard only at desktop: logical focus order, no trap, visible focus, and Escape closes dialogs.
- Screen reader: one useful page heading, named landmarks, labelled editors and controls, status
  changes announced, and disclosure state exposed.
- Mobile touch: interactive targets are at least 44 x 44 CSS px or have equivalent hit area; no
  action depends on hover, right-click, or hardware keyboard.
- Zoom and reflow: complete workflows at 200% desktop zoom and 320 CSS px without two-dimensional
  page scrolling.
- Contrast: 4.5:1 for normal text, 3:1 for large text and meaningful UI graphics/focus indicators.
- Motion: `prefers-reduced-motion: reduce` removes non-essential animation and smooth scrolling.
- Forced colors/high contrast: focus, selected state, task state, links, and errors remain distinct.
- Text alternatives: icon-only buttons have accessible names and decorative icons stay silent.

Known baseline risks to re-test first:

1. Search result rows are not actionable links.
2. Today does not yet expose a reliable, testable “editor focused and input-ready” signal.
3. Status changes and persistence errors do not have a documented live-region announcement.
4. The desktop-only context rail disappears below 1280 px; essential context must remain reachable.

## Change control

- Update this document when a canonical workflow, breakpoint, step count, metric definition, or
  release budget changes.
- Record measurement date, commit, fixture size, browser/device, and all raw runs.
- A faster number obtained with less data is not an improvement; keep fixtures comparable.
- If a release knowingly exceeds a budget, document the owner, reason, user impact, and follow-up
  issue in the release checklist. Accessibility blockers and data-loss risks are never waivable.

