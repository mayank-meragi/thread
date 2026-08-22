# UX regression checklist

Use this checklist for every release candidate. Copy it into the release issue or PR and attach raw
performance results where noted.

## Run record

- Release/commit:
- Tester and date:
- Desktop browser, OS, viewport:
- Mobile browser/device, viewport:
- Database fixture (days / blocks / tasks / threads):
- Network modes tested: online / offline / throttled
- Compared with baseline commit:

## Automated gates

- [ ] `npm test` passes.
- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.
- [ ] No unexpected console errors occur during the five core jobs.

## Core workflows

### Capture

- [ ] Desktop Today accepts typing immediately and places the cursor at the intended block.
- [ ] Mobile Today accepts typing without content being covered by the keyboard or editor toolbar.
- [ ] Enter, indent, outdent, move, collapse, undo, and redo preserve outline structure.
- [ ] A reload restores the exact Markdown and block order.
- [ ] Capture remains usable offline and while GitHub sync is pending or failing.

### Structure

- [ ] A task created in the editor appears in Tasks and remains linked to its source block.
- [ ] Task quick add creates a canonical block in today's journal.
- [ ] A subtask nests under the correct parent and updates parent progress.
- [ ] Existing and new inline tags commit, persist, and filter correctly.
- [ ] Existing and new wikilinks round-trip as `[[title]]` and open the intended thread.
- [ ] Mobile exposes working indent, outdent, task, wikilink, idea, question, and decision actions.

### Retrieve

- [ ] `Cmd/Ctrl+K` opens Search and focuses the query.
- [ ] Mobile Search is reachable from bottom navigation.
- [ ] A journal result opens the exact matching day/block and visibly identifies it.
- [ ] Thread and task matches are reachable with keyboard and touch.
- [ ] Search includes the latest local edit, works offline, and has a useful zero-result state.

### Act

- [ ] Task status changes agree in Today, Tasks, thread views, and the source outline.
- [ ] Due date, start date, priority, estimate, title, and description survive reload.
- [ ] Filters, counts, grouping, sorting, bulk actions, and parent progress recompute correctly.
- [ ] Success is acknowledged immediately; persistence/sync failures are clearly announced.
- [ ] Destructive actions identify scope, require confirmation, and preserve unrelated blocks.

### Revisit context

- [ ] Recent thread navigation works on desktop and mobile.
- [ ] Current direction, notes, questions, tasks, decisions, thoughts, and ideas use source data.
- [ ] Every projected item can open its source day/block.
- [ ] Back/forward, app tabs, Today, and source-return preserve location and unsaved input.
- [ ] Generated/projection content remains visually and semantically distinct from source text.

## Performance

Follow the definitions and budgets in [`ux-foundation.md`](./ux-foundation.md). Attach all five raw
runs, median, p75, worst result, fixture size, and whether the run was cold or warm.

- [ ] Desktop app shell startup is within budget.
- [ ] Mobile app shell startup is within budget.
- [ ] Desktop and mobile editor startup are within budget.
- [ ] Desktop and mobile typing p75 and worst-case latency are within budget.
- [ ] Search response with 10,000 blocks is within budget.
- [ ] Task acknowledgement and IndexedDB persistence are within budget.
- [ ] Background sync does not push an interaction over budget.
- [ ] No long task over 50 ms is introduced during the 200-character typing trace.

## Accessibility

- [ ] All five jobs complete with keyboard only; focus is visible and follows a logical order.
- [ ] Dialogs/sheets trap focus while open, close with Escape, and restore focus to their trigger.
- [ ] VoiceOver or NVDA announces page structure, editors, control names, states, errors, and results.
- [ ] Status changes and result counts are announced without moving focus unexpectedly.
- [ ] Normal text meets 4.5:1 contrast; large text and meaningful UI graphics meet 3:1.
- [ ] Workflows reflow at 200% desktop zoom and 320 CSS px without horizontal page scrolling.
- [ ] Touch targets meet 44 x 44 CSS px or provide an equivalent hit area.
- [ ] Workflows remain complete without hover or a hardware keyboard.
- [ ] Reduced-motion mode removes non-essential animation and smooth scrolling.
- [ ] Forced-colors/high-contrast mode preserves focus, links, selection, task state, and errors.

## Responsive and resilience checks

- [ ] Desktop layout at 1440 px shows sidebar, writing surface, and applicable context.
- [ ] Context remains reachable when the context rail hides below 1280 px.
- [ ] Tablet behavior near 1100 px does not clip task filters or primary controls.
- [ ] The 760 px breakpoint switches cleanly between desktop and mobile navigation.
- [ ] Mobile layout at 390 x 844 respects safe areas and the software keyboard.
- [ ] The app restores after refresh, browser restart, offline restart, and an interrupted sync.
- [ ] Light/dark themes do not change meaning, contrast, or focus visibility.

## Release decision

- [ ] No data-loss, inaccessible-core-workflow, or local-first blocker remains.
- [ ] Every other failed item has an owner, impact statement, follow-up issue, and explicit approval.
- [ ] Performance results and known deviations are attached to the release record.
- [ ] Final decision recorded: **ship / hold**.

