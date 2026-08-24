# Thread design system

This documents the token layer and shared primitives introduced to consolidate Thread's UI styling
(`src/styles/tokens.css`, `base.css`, `primitives.css`, `features.css`, and `src/components/ui/`).
Read it before adding a new theme, a new popover/modal/banner, or new small type.

## File layout

`src/main.tsx` imports four stylesheets in this order:

1. **`tokens.css`** — the default `:root` plus the three named theme blocks (`solarized-light`,
   `dracula`, `nord`), and theme-independent tokens (typography, spacing, radius, state) that don't
   vary per theme.
2. **`base.css`** — global element resets (box-sizing, `sr-only`, focus-visible, forced-colors).
3. **`primitives.css`** — shared CSS classes (`.menu-panel`, `.dialog`/`.sheet`, `.field`, `.banner`,
   `.btn`, `.chip`, `.empty-state`, `.spin`) that bespoke widgets compose onto.
4. **`features.css`** — everything page/component-specific. A feature rule that composes a primitive
   keeps only its own positioning/sizing overrides; it should not re-declare border, radius,
   background, or shadow that the primitive already provides.

`src/components/ui/` holds the React primitives: `Button`, `Chip`, `EmptyState`, `Spinner`.

## Adding a theme

A theme is a `:root[data-theme='name']` block in `tokens.css` that redefines the same ~30 custom
properties as the default block (`--canvas`, `--paper`, `--ink`, the six semantic accent pairs, line/
outline colors, glass/nav tints, and `--shadow`/`--shadow-soft`, from which `--shadow-1/2/3` derive).
Typography, spacing, and radius tokens are theme-independent and don't need to be repeated. Register
the theme name in `src/lib/theme.ts` and `SettingsPage.tsx`'s theme picker. Run the contrast checks
below against the new palette before shipping it.

## Typography roles

| Token | Value | Use |
| --- | --- | --- |
| `--font-display` | `'Newsreader', serif` | Page/section headings, large numerals |
| `--font-ui` | `'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif` | Body copy, controls, labels |
| `--font-mono` | `'IBM Plex Mono', monospace` | Eyebrows, kbd hints, timestamps, code |
| `--text-meta` | `12px` | The metadata floor — smallest size for text a user reads for content |
| `--text-sm` | `13px` | Secondary UI text (menu items, chips, field values) |
| `--text-md` | `14px` | Primary UI text |
| `--text-body` | `16px` | Editor prose |

## Sizing rules

- **12px metadata floor.** Any text a user reads to understand data — timestamps, counts, form
  labels, tag names, status text — must be at least `--text-meta` (12px). Phase 3 bumped the 50
  `features.css` declarations that used a literal `font-size: 9px/10px/11px` to this floor.
- **Decorative exception.** Type set with the `font: ... 'IBM Plex Mono', monospace` shorthand
  *and* an uppercase/letter-spaced "eyebrow" treatment, or literal `kbd` keyboard-shortcut hints,
  stays below 12px by design — it's UI chrome (section dividers, keyboard hints, micro badges), not
  content a user needs to read at length. Examples: `.eyebrow`, `.sidebar-label`, `.block-inspector-kicker`,
  `.task-detail-kicker`, `kbd`, `.command-sheet > footer kbd`, `.schema-column-head`. If you're adding
  new small type and it's not one of these two shapes, it belongs at the 12px floor.
- **44px touch targets.** `.menu-item` and `.field-control` set `min-height: 44px`. For an existing
  icon-only control that's visually smaller than that but has enough surrounding whitespace, add the
  `.tap-target-sm` primitive class — it expands the hit-testable area via a centered pseudo-element
  without changing the visual size. Don't add it to controls packed tightly against another
  interactive sibling (e.g. inline outline toggles); the 44px hit area would swallow the neighbor's
  tap target — leave those as a known gap instead.

## State matrix

| State | Visual | ARIA |
| --- | --- | --- |
| Focus | `outline: 3px solid var(--focus-ring)` (`base.css`), extended to `select`/`textarea` in Phase 3 (previously only `button`/`a`/`input`). Forced-colors mode swaps the outline color to `Highlight`. | N/A — outline is the indicator |
| Error | `.banner.banner-error` (or `.field.field-error`'s red border) | `role="alert"` on the banner element (see `BlockInspector.tsx`, `TaskDetails.tsx`) |
| Loading | `.spin` keyframe; `Button`'s `loading` prop renders a `Spinner` and hides the label | `aria-busy="true"` on the control; `Spinner` sets `role="status"` |
| Saving | No dedicated component — `RailSyncIndicator.tsx` is the one polite `aria-live` region in the app today. A second async-save surface should reuse that pattern rather than adding a new live region. | `aria-live="polite"` |
| Disabled | `opacity: var(--disabled-opacity)` (0.45) + `cursor: default` | `disabled` attribute or `aria-disabled="true"` |

## Popover / modal / banner primitives

- **`.menu-panel` + `.menu-item`** — anchored popovers: `PersonaSwitcher`, `DatePicker`,
  `TaskStatusControl`, `IconPicker`, the link-context-menu (`RouteTab.tsx`, `lib/tabsApi.tsx`), and
  the editor suggestion menu (`lib/inlineSuggestions.ts`).
- **`.layer-backdrop` (`.layer-backdrop-center`/`.layer-backdrop-end`, `.layer-backdrop-blur`) +
  `.dialog`/`.sheet`** — full-screen modals: `GlobalCommandMenu` and `TabSwitcher` use the centered
  `.dialog` shape; `BlockInspector` and `TaskDetails` use the edge-anchored `.sheet` shape (their
  side-panel shadow direction is a component-level override, since `.sheet`'s default shadow points
  down for bottom sheets, not sideways for edge panels).
- **`.field` / `.field-control`** — input/select/textarea recipe with `:focus-visible`, `.field-error`,
  and `.field-hint` states.
- **`.banner` (`.banner-info`/`.banner-warning`/`.banner-error`/`.banner-success`)** — replaces
  `.form-error`, `.inspector-error`, `.chat-message-error`.

None of this migration touched a component's ARIA (`role`, `aria-modal`, focus trap, Escape-to-close)
or event logic — only which CSS classes render the same markup.

## Motion

- `@keyframes spin` and `.spin` live in `primitives.css`; `Spinner.tsx` and the in-progress task
  status icon both use it.
- `@media (prefers-reduced-motion: reduce)` in `features.css` zeroes `animation-duration`,
  `transition-duration`, and `scroll-behavior` on every element via the universal selector, so it
  automatically covers new transitions/animations added anywhere in the four stylesheets — nothing
  to register per-component.
- `@media (forced-colors: active)` in `base.css` forces the focus outline to the system `Highlight`
  color, since the default focus ring relies on a custom color that forced-colors mode can strip.

## Contrast audit

Ratios below are computed from the token hex values using the standard WCAG relative-luminance
formula (not a browser measurement — this environment can't screenshot the four themes side by side,
per `docs/ux-regression-checklist.md`'s note that visual passes are manual). Rule, per
[`docs/ux-foundation.md:149`](ux-foundation.md): **4.5:1 for normal text, 3:1 for large text and
meaningful UI graphics/focus indicators.**

Three pairs failed on first measurement and were fixed by darkening/lightening the token *value*
only (no selector or structural change) during this audit — see the inline comments on the affected
tokens in `tokens.css`:

- **solarized-light**: `--muted` (`#657b83`→`#586b72`), `--thread`/`--question` (`#268bd2`→`#2074af`),
  `--danger` (`#dc322f`→`#b9221f`), `--task` (`#708800`→`#576900`), plus their dependent
  `--focus-ring`/`--accent-line` rgba triplets.
- **dracula**: `--danger-soft` (`#50343c`→`#372429`).
- **nord**: `--danger-soft` (`#513b42`→`#161012`), `--task-soft` (`#3e4d40`→`#354237`).

Final measured ratios, all passing:

### default

| Pair | Foreground | Background | Ratio | Target |
| --- | --- | --- | --- | --- |
| ink / paper (body text) | `#1f2328` | `#ffffff` | 15.80:1 | 4.5:1 |
| ink-soft / paper | `#3f4650` | `#ffffff` | 9.53:1 | 4.5:1 |
| muted / paper (metadata) | `#656d76` | `#ffffff` | 5.25:1 | 4.5:1 |
| muted / canvas (metadata) | `#656d76` | `#f6f8fa` | 4.93:1 | 4.5:1 |
| ink / control (form text) | `#1f2328` | `#f6f8fa` | 14.84:1 | 4.5:1 |
| thread / paper (links) | `#0969da` | `#ffffff` | 5.19:1 | 4.5:1 |
| on-solid / thread (button text) | `#ffffff` | `#0969da` | 5.19:1 | 4.5:1 |
| danger / danger-soft (banner) | `#cf222e` | `#ffebe9` | 4.67:1 | 4.5:1 |
| task / task-soft (banner) | `#1a7f37` | `#dafbe1` | 4.56:1 | 4.5:1 |
| thread / canvas (focus/UI) | `#0969da` | `#f6f8fa` | 4.88:1 | 3.0:1 |

### solarized-light

| Pair | Foreground | Background | Ratio | Target |
| --- | --- | --- | --- | --- |
| ink / paper (body text) | `#073642` | `#fdf6e3` | 12.05:1 | 4.5:1 |
| ink-soft / paper | `#31545c` | `#fdf6e3` | 7.62:1 | 4.5:1 |
| muted / paper (metadata) | `#586b72` | `#fdf6e3` | 5.18:1 | 4.5:1 |
| muted / canvas (metadata) | `#586b72` | `#eee8d5` | 4.56:1 | 4.5:1 |
| ink / control (form text) | `#073642` | `#f3ecd9` | 11.03:1 | 4.5:1 |
| thread / paper (links) | `#2074af` | `#fdf6e3` | 4.66:1 | 4.5:1 |
| on-solid / thread (button text) | `#ffffff` | `#2074af` | 5.03:1 | 4.5:1 |
| danger / danger-soft (banner) | `#b9221f` | `#f5d9d1` | 4.75:1 | 4.5:1 |
| task / task-soft (banner) | `#576900` | `#e6e7c9` | 4.86:1 | 4.5:1 |
| thread / canvas (focus/UI) | `#2074af` | `#eee8d5` | 4.10:1 | 3.0:1 |

### dracula

| Pair | Foreground | Background | Ratio | Target |
| --- | --- | --- | --- | --- |
| ink / paper (body text) | `#f8f8f2` | `#282a36` | 13.36:1 | 4.5:1 |
| ink-soft / paper | `#e1e2dc` | `#282a36` | 10.93:1 | 4.5:1 |
| muted / paper (metadata) | `#a9adc1` | `#282a36` | 6.40:1 | 4.5:1 |
| muted / canvas (metadata) | `#a9adc1` | `#191a21` | 7.79:1 | 4.5:1 |
| ink / control (form text) | `#f8f8f2` | `#343746` | 11.06:1 | 4.5:1 |
| thread / paper (links) | `#bd93f9` | `#282a36` | 5.90:1 | 4.5:1 |
| on-solid / thread (button text) | `#191a21` | `#bd93f9` | 7.19:1 | 4.5:1 |
| danger / danger-soft (banner) | `#ff5555` | `#372429` | 4.62:1 | 4.5:1 |
| task / task-soft (banner) | `#50fa7b` | `#304b3b` | 6.97:1 | 4.5:1 |
| thread / canvas (focus/UI) | `#bd93f9` | `#191a21` | 7.19:1 | 3.0:1 |

### nord

| Pair | Foreground | Background | Ratio | Target |
| --- | --- | --- | --- | --- |
| ink / paper (body text) | `#eceff4` | `#2e3440` | 10.84:1 | 4.5:1 |
| ink-soft / paper | `#d8dee9` | `#2e3440` | 9.25:1 | 4.5:1 |
| muted / paper (metadata) | `#a7b0c0` | `#2e3440` | 5.72:1 | 4.5:1 |
| muted / canvas (metadata) | `#a7b0c0` | `#242933` | 6.68:1 | 4.5:1 |
| ink / control (form text) | `#eceff4` | `#3b4252` | 8.73:1 | 4.5:1 |
| thread / paper (links) | `#88c0d0` | `#2e3440` | 6.24:1 | 4.5:1 |
| on-solid / thread (button text) | `#242933` | `#88c0d0` | 7.29:1 | 4.5:1 |
| danger / danger-soft (banner) | `#bf616a` | `#161012` | 4.60:1 | 4.5:1 |
| task / task-soft (banner) | `#a3be8c` | `#354237` | 5.19:1 | 4.5:1 |
| thread / canvas (focus/UI) | `#88c0d0` | `#242933` | 7.29:1 | 3.0:1 |

This is a spot-check of the highest-traffic pairs (body text, metadata, links, primary buttons,
error/success banners, focus/UI color), not exhaustive of every color combination in `features.css`.
No automated CI gate enforces this — per the existing team decision noted in
`docs/ux-foundation.md`, contrast stays a manual check, re-run whenever a token value changes or a
new theme is added.
