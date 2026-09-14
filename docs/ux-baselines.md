# UX baseline capture record

This is the Phase 1 baseline record for the Fiber + Thread UI work. It is a
visual reference for later migration phases, not a claim that the current
layout is final.

## Capture record

- Date: 2026-09-13
- Environment: local Vite development server
- Desktop reference viewport: 1280 x 720 browser viewport
- Theme: GitHub Light (default)
- Data fixture: local seeded journal with Today content, recent threads, and
  the existing feature data available in IndexedDB
- Capture method: in-app browser visual review

## Captured surfaces

| Surface | Route | Baseline purpose |
| --- | --- | --- |
| Fiber catalog | `/thread/fiber.html` | Component inventory, navigation density, specimen spacing, and shared control states |
| Today | `/thread/#/` | App chrome, daily journal hierarchy, outline density, task projection, and context rail |
| Tasks | `/thread/#/tasks` | Filters, toolbar density, list/board surfaces, selection, and task row rhythm |
| Settings | `/thread/#/settings` | Navigation density, settings cards, form controls, and theme selection |
| Feeds | `/thread/#/feeds` | Feed rows, folder controls, dialogs, import/subscribe actions, and empty/loading states |
| Recipes | `/thread/#/recipes` | Search, import actions, recipe rows, and form controls |
| Workouts | `/thread/#/workouts` | Tabs, range controls, workout rows, empty states, and metric hierarchy |

## Baseline observations

- The app shell is already visually quiet, but several feature surfaces still
  use independent heights, radii, and padding values.
- Today benefits from the strongest reading hierarchy; its editor should remain
  the spacing reference for content-first surfaces.
- Tasks and Workouts have the greatest opportunity for denser reusable rows and
  grouped action controls.
- Settings has repeated card and form patterns that should migrate together,
  after the density and form-control tokens are stable.
- Feeds and Recipes contain repeated dialog, search, and select patterns that
  should become Fiber compositions rather than feature-specific CSS.
- The Fiber catalog itself is now a compact split workspace and should become
  the state/variant reference as new primitives are added.

## Before Phase 2

- Re-capture the same surfaces after any token-only change that affects layout.
- Add mobile reference captures at 390 x 844 before migrating responsive
  controls.
- Add dark-theme captures for Dracula, Nord, and Catppuccin Mocha before a
  broad surface migration.
- Keep this route list stable so future visual comparisons remain meaningful.
