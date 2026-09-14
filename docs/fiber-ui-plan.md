# Fiber + Thread UI plan

This plan defines how Fiber and Thread can embody a simple, sleek, clear, and
space-efficient interface philosophy.

Implementation status is recorded below as each phase lands. The plan remains
the design and migration reference for later work.

## Phase 1 status

Phase 1 foundation work is now in place: semantic tokens and density hooks are
defined, shared primitives consume the control-height contract, component
contracts and exceptions are documented in [`fiber-ui-contracts.md`](fiber-ui-contracts.md),
and representative baseline captures are recorded in
[`ux-baselines.md`](ux-baselines.md). The default token values preserve the
current UI while Phase 2 begins the visible primitive migration.

## Phase 2 status — complete

The existing primitive foundation now supports structured menu slots, semantic
chip APIs, keyboard-safe token removal, compact/panel empty states with
actions, read-only input semantics, density-aware shared dimensions, and
loading states that keep labels readable. Contract coverage lives in
[`packages/fiber/src/primitives.test.tsx`](../packages/fiber/src/primitives.test.tsx).

Page-level form-control migration remains Phase 3 work; no broad feature
surface has been restyled yet.

## Phase 3 status — control foundation complete

The first form-control layer is now available: native `Select` and `Textarea`
controls consume Field metadata, `Checkbox` and `RadioGroup` preserve native
selection semantics, `SearchField` keeps filtering affordances inside one
control, and `FormLayout` provides a responsive density-aware grid. The Fiber
gallery covers each new control. The dense task-filter popover is the first
feature surface migrated to the shared `Field` + `Select` recipe; inspector
property editing, task drafts, recipe import notes, add-property creation, and
metadata field defaults now use the shared controls as well. Workout set unit
controls now use the same Select recipe while preserving the compact workout
grid, and the model catalog now uses shared Select and Checkbox semantics.
Settings category, RSS schedule, AI provider/model, and persona text controls
now use shared Fiber primitives as well; the model catalog preserves its dense
table geometry while using shared Select and Checkbox controls. The remaining
imperative task metadata row applies the same Fiber control classes at mount
time, and checklist rows use the shared Checkbox primitive without losing their
custom compact layout. The first Phase 4 primitive, `SegmentedControl`, now
owns mutually exclusive range, metric, and task display-mode choices with
keyboard navigation. Feature-by-feature migration remains the next step in
this phase.

The remaining React-owned native selects are now migrated too: task grouping
and bulk-priority controls use `Select`, and the workout history status filter
uses the same primitive. The only raw select markup left is the imperative task
metadata row, which is intentionally mounted outside React and already carries
the shared Fiber select classes and wrapper contract.

SearchField is now the shared recipe for the main Search page, task and workout
filters, recipe search, and icon-picker filtering. Its affordances stay inside
the control while each surface keeps its own sizing and layout rules.

## Phase 4 status — component migration in progress

### Migration order

Thread will replace legacy patterns one Fiber component at a time. The active
sequence is:

1. `SectionHeader` — migrate recurring section headings first, including
   settings, task groups and board columns, workout insight panels, journal day
   headings, inspector sections, and recipe panels. Remove the corresponding
   legacy heading selectors after the surface is verified.
2. `ListRow` — migrate dense, repeated rows next, including task, workout,
   exercise, and other list surfaces that fit the shared slot contract. Remove
   the legacy row markup/styles only after every in-scope consumer is covered.
3. `Tooltip` — replace native `title` bubbles for icon actions and abbreviated
   metadata. Keep native titles only where they are the only practical
   explanation for a disabled control or non-interactive element.

For each component, completion requires a repository-wide usage search, visual
and responsive review, keyboard/accessibility checks, passing tests and build,
and removal of unused legacy styles. The next component does not start until
that checklist is complete.

The `SectionHeader` slice is complete for the in-scope recurring headings;
the next active migration is `ListRow`.

`SegmentedControl` is now available in Fiber with one selected value, native
radio semantics, and Arrow/Home/End keyboard movement. Workout insight range
and metric choices plus the Tasks display-mode switch use it, establishing the
shared recipe for the remaining navigation and row primitives.

`Tabs` is now available for real panel navigation. Workouts and Recipes use the
shared tablist, with stable tab-to-panel IDs and one keyboard focus stop while
their existing responsive presentation remains intact.

`ActionGroup` now supplies shared spacing and wrapping for related commands.
Feeds, Recipes, Meal Plan, and Today compose it in their headers while keeping
button emphasis and page-specific responsive rules local.

`SectionHeader` now owns compact section hierarchy and optional metadata or
actions. Settings, task groups and board columns, workout insight panels,
journal day headings, inspector sections, and recipe panels use the shared
alignment contract while retaining their existing content and spacing.

`ListRow` is now available for dense, scannable content with leading/status,
description, metadata, selection, and trailing-action slots. The Workouts,
Today tasks, and workout overview rows use it while preserving their existing
responsive layout and link behavior.

`Tooltip` now provides short, accessible context on hover and keyboard focus.
The Fiber gallery demonstrates its placement contract, while icon actions,
abbreviated metadata, and native title bubbles in migrated surfaces use it.

## Agreed decisions

- Use inherited `compact`, `default`, and `comfortable` density modes.
- Expand Fiber beyond the current primitives to cover recurring controls and
  interaction patterns.
- Keep shared chip styling but expose semantic APIs: `Tag`, `Status`,
  `FilterChip`, and `Token`.
- Keep typography role-based while making font choices theme-controlled.
- Use four surface levels: canvas, base, inset, and floating.
- Use one primary accent per theme; reserve semantic colors for actual meaning.
- Keep Fiber thin and composable over native HTML.
- Migrate incrementally, one surface at a time.
- Use visual, keyboard, accessibility, theme, and responsive checks as release
  gates.

## 1. Design principles

### Space efficiency

- Remove duplicated shells, nested cards, excess explanatory copy, and
  decorative padding.
- Use space at information boundaries, not uniformly around every element.
- Prefer alignment, type hierarchy, and one divider over multiple borders,
  fills, and shadows.
- Keep desktop controls visually compact while preserving usable hit areas.
- Use comfortable spacing only for touch-first or focus-heavy workflows.

### Clarity

- Every component has one primary job.
- Use one visual signal for one state wherever possible.
- Keep action labels stable across the product.
- Make destructive, selected, focused, loading, and disabled states
  unmistakable.
- Do not use color or icons as the only carrier of meaning.

### Quiet chrome

- Thread content should dominate the interface.
- Default controls should be neutral.
- Accent color identifies focus, selection, links, progress, or the local
  primary action.
- Shadows are reserved for floating layers.
- Large rounded cards are not the default hierarchy mechanism.

### Typography

- `--font-display`: page, document, and major section titles.
- `--font-ui`: body UI, controls, labels, menus, and descriptions.
- `--font-mono`: code, shortcuts, technical identifiers, and numeric metadata.
- Fonts and optional weight/tracking adjustments are defined per theme.
- Ordinary sections should not use generic uppercase monospaced eyebrows.

## 2. Foundation changes

### Tokens

Extend `src/styles/tokens.css` with:

- Density-specific heights and padding.
- Component gap tokens.
- Surface tokens for canvas, base, inset, and floating.
- Subtle, standard, and strong border tokens.
- Text-role tokens.
- Focus, selected, success, warning, and danger state tokens.
- Theme-specific font variables.

Each theme must define the same semantic contract even if its actual colors and
fonts differ.

### Density

Use inherited density rather than arbitrary component-level dimensions:

- `compact`: desktop menus, navigation, tables, inspectors, and toolbars.
- `default`: general forms and mixed pointer/touch surfaces.
- `comfortable`: mobile controls, confirmations, cooking, and other focused
  workflows.

Compact visual controls may use an expanded effective hit area where targets do
not overlap. Mobile controls should render at a true comfortable height.

### State contract

Every Fiber component should document and demonstrate:

- Default
- Hover
- Focus-visible
- Active
- Selected or pressed
- Disabled
- Loading
- Error, where applicable
- Reduced motion
- Forced colors
- Mobile behavior

## 3. Existing primitive plan

| Component | Direction |
| --- | --- |
| `Button`, `ButtonLink` | Reduce variant ambiguity into primary, secondary, quiet, and danger emphasis. Tokenize dimensions and icon sizing. Preserve labels during loading where possible. Define action-group ordering and full-width behavior. |
| `IconButton` | Keep required accessible labels. Add standard tooltip integration, selected/notification states, density support, and documented guidance for unfamiliar icons. |
| `ToggleButton` | Retain for independent pressed state. Move mutually exclusive choices to `SegmentedControl` or `ToggleGroup` with arrow-key behavior. |
| `MenuItem` | Add leading/trailing slots for icons, checks, shortcuts, values, and descriptions. Use compact desktop rows and comfortable touch rows. Standardize selected, checked, disabled, and destructive semantics. |
| `Chip` | Internally share styles but expose `Tag`, `Status`, `FilterChip`, and `Token`. Fix removable-token keyboard semantics and avoid nested pseudo-buttons. |
| `Spinner` | Keep for brief indefinite loading. Add inline, control, and surface placements. Add `Progress` for measurable work and avoid unnecessary live-region announcements. |
| `EmptyState` | Add inline, panel, and first-use modes. Keep routine empty states compact and left-aligned. Require a useful next action where one exists. |
| `Field` | Support label metadata, trailing actions, horizontal compact layouts, `FieldGroup`, pending states, and responsive vertical collapse. |
| `Input` | Add leading/trailing slots, clear actions, prefixes/suffixes, density support, and explicit read-only styling. Build shared recipes for search, secret, date, and number inputs. |

## 4. New Fiber components

### Form controls

- `Select`: native semantics, shared Field wiring, standard chevron, and
  compact inspector mode.
- `Textarea`: shared labels/errors, optional auto-grow, and consistent resize
  behavior.
- `Checkbox`: checked, mixed, disabled, error, and full-label interaction.
- `RadioGroup`: semantic single-choice selection with arrow-key navigation.
- `SearchField`: icon, clear action, optional shortcut, and result-count
  relationship.
- `FormLayout`: standard field rhythm, responsive columns, and action
  placement.

### Navigation and actions

- `SegmentedControl`: mutually exclusive compact choices.
- `Tabs`: semantic navigation/panel switching, single indicator, and mobile
  overflow.
- `Toolbar` and `ActionGroup`: action priority, responsive overflow, and
  selection-action separation.
- `ListRow`: dense reusable row with title, metadata, status, selection, and
  actions.
- `SectionHeader`: compact title/action alignment without decorative eyebrows.
- `Tooltip`: hover/focus support for unfamiliar icons and shortcuts.
- `Breadcrumbs`/`BackLink`: consistent hierarchy navigation where needed.

### Layers and feedback

- `Popover`/`Menu`: shared positioning, dismissal, Escape, focus return, and
  mobile fallback.
- `Dialog`: structured header/body/footer, focus trap, initial focus, Escape,
  and focus return.
- `Sheet`: shared dialog behavior with edge placement and mobile bottom-sheet
  adaptation.
- `Alert`: info, success, warning, and error semantics with optional actions.
- `Toast`: transient async feedback with deduplication and polite
  announcements.
- `Progress`: measurable progress.
- `Skeleton`: restrained loading placeholders only where final layout is
  predictable.

## 5. Fiber gallery

Turn `/thread/fiber.html` into a component QA surface.

For each component, show:

- Purpose and non-use cases.
- Variants and density modes.
- Complete state matrix.
- Keyboard behavior.
- Accessibility contract.
- Light and dark theme treatment.
- Responsive behavior.
- Recommended composition.
- A real Thread usage example.
- Common misuse.

Add gallery controls for:

- Theme.
- Density.
- Desktop/mobile width.
- Focus, hover, disabled, loading, and error simulation.
- Reduced-motion and forced-colors guidance.

The gallery itself should remain compact and demonstrate the design philosophy.

## 6. Thread migration sequence

### Phase 1 — Foundation

- Add semantic density, surface, border, state, and font tokens.
- Define component contracts and exceptions.
- Capture baseline screenshots for Today, Thread, Tasks, Settings, Feeds,
  Recipes, Workouts, dialogs, and mobile views.

### Phase 2 — Existing primitives

- Refine the current 10 primitives.
- Add density inheritance, slots, semantic states, and gallery coverage.
- Add unit and interaction tests before broad feature migration.

### Phase 3 — Form controls

- Build and migrate `Select`, `Textarea`, `Checkbox`, `RadioGroup`,
  `SearchField`, and `FormLayout`.
- Start with Settings, inspectors, Tasks, Recipes, Feeds, Workouts, and
  metadata forms.
- Remove redundant feature-level control styling after each migration.

### Phase 4 — Navigation and rows

- Add `SegmentedControl`, `Tabs`, `Toolbar`, `ActionGroup`, `ListRow`,
  `Tooltip`, and `SectionHeader`.
- Migrate Tasks, Workouts, Recipes, Feeds, Settings, and Thread toolbars one
  surface at a time.

### Phase 5 — Layers and feedback

- Centralize Popover, Menu, Dialog, Sheet, Alert, Toast, Progress, and
  Skeleton behavior.
- Preserve existing ARIA, focus, Escape, dismissal, and announcement behavior
  while changing visual composition.

### Phase 6 — Page-level simplification

For every page:

- Remove redundant wrappers and repeated headings.
- Collapse toolbars and action clusters.
- Replace unnecessary card grids with rows or sections.
- Reduce decorative borders and shadows.
- Review populated, empty, loading, error, and mobile states.
- Validate panel-width behavior independently from viewport-width behavior.

### Phase 7 — Regression prevention

- Add visual snapshots for every Fiber specimen.
- Add representative Thread page snapshots.
- Add keyboard and focus-flow tests.
- Add automated accessibility checks.
- Add theme contrast checks.
- Detect undocumented raw controls and one-off Fiber-like CSS.
- Maintain an explicit exception list.

## 7. Validation bar

The work is complete when:

- More useful content fits in the same viewport without reduced legibility.
- Visual hierarchy is clear without stacked cards or excess decoration.
- Desktop density improves while mobile targets remain comfortable.
- Identical actions look and behave consistently across pages.
- New screens can be built without raw one-off control CSS.
- All themes remain readable and coherent.
- Keyboard-only workflows remain complete.
- Focus never disappears in compact layouts.
- Loading and save feedback do not cause layout jumps.
- Empty states direct the user toward a clear next action.

## 8. Main risks

- Global dimension changes could affect hundreds of existing Button and Input
  usages.
- Compact controls could become inaccessible if effective targets overlap.
- Feature CSS may override Fiber defaults until migration is complete.
- Too many density exceptions would recreate inconsistency.
- Over-unification could erase useful differences between writing, tasks,
  cooking, and workouts.
- Native controls need cross-browser visual review.
- Dark themes may expose excessive borders or surface contrast even when WCAG
  ratios pass.

## Critical files for implementation

- `src/styles/tokens.css`
- `packages/fiber/src/styles.css`
- `packages/fiber/src/index.ts`
- `src/styles/features.css`
- `src/components/fiber/FiberGallery.tsx`
