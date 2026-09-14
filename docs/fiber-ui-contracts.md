# Fiber UI contracts

This document is the Phase 1 contract for Fiber primitives and the Thread
surfaces that compose them. It describes the rules future component work must
follow; it does not replace component-specific API documentation.

## Density

Density is inherited from the nearest page or work-surface container:

```html
<main data-density="compact">...</main>
```

Supported values:

- `compact`: desktop navigation, menus, tables, inspectors, and toolbars.
- `default`: general forms and mixed pointer/touch surfaces.
- `comfortable`: mobile controls, confirmations, cooking, and focused flows.

Components consume the active `--control-*` aliases. Feature CSS must not
invent a fourth density or override a primitive's height without documenting an
exception.

Compact visual controls may expose a larger effective hit area when adjacent
targets do not overlap. Mobile controls should use a true 44px-or-larger target.

## Surface and elevation

Use the semantic surface aliases:

| Surface | Meaning | Typical use |
| --- | --- | --- |
| `--surface-canvas` | Surrounding workspace | App background, rail, page gutters |
| `--surface-base` | Primary content | Documents, lists, cards that represent real objects |
| `--surface-inset` | Recessed or interactive control surface | Inputs, selected rows, quiet grouped controls |
| `--surface-floating` | Layer above the workbench | Menus, dialogs, sheets, command surfaces |

Borders and alignment establish hierarchy first. `--elevation-floating` and
`--elevation-modal` are reserved for floating layers. Ordinary rows, sections,
and forms should use `--elevation-none`.

## Color

- `--state-focus` and `--state-selected` use the theme's one primary accent.
- `--state-success`, `--state-warning`, and `--state-danger` are semantic only.
- A tinted surface must communicate state or improve scanning; it is not
  decoration.
- Meaning must remain available through text, shape, position, or ARIA—not
  color alone.

## Typography

Themes own the concrete values of:

- `--font-display` for page and document titles.
- `--font-ui` for controls, labels, descriptions, and body UI.
- `--font-mono` for code, shortcuts, technical identifiers, and numeric
  metadata.

Ordinary section labels should use sentence case UI text. Uppercase mono text is
reserved for genuinely technical metadata or compact chrome.

## Primitive contracts

### Buttons

- Use one primary action per local action group.
- Use quiet actions for toolbar and low-emphasis commands.
- Use danger treatment only for destructive actions.
- Preserve native keyboard behavior and the visible focus ring.
- Loading must expose `aria-busy`, keep the action label readable, and avoid
  layout shift.

### Icon buttons

- Require an accessible name.
- Add a tooltip for unfamiliar icons, but never make the tooltip the only
  explanation for a critical action.
- Do not use an icon-only destructive action when a text label is practical.

### Toggles, segmented controls, and tabs

- `ToggleButton` is for independent pressed state.
- `SegmentedControl` is for mutually exclusive choices.
- `SegmentedControl` exposes a named `radiogroup`, one tabbable selection, and
  Arrow/Home/End movement across enabled options.
- `Tabs` are for navigation or panel switching.
- `Tabs` expose `role="tablist"`, `role="tab"`, `aria-selected`, and
  `aria-controls`; only the selected tab is in the tab sequence and arrows move
  between enabled tabs.

### Action groups

- `ActionGroup` owns spacing, alignment, and wrapping only. Children retain
  their own variant, label, loading, and disabled semantics.
- Use one primary action per group; do not use the wrapper to make unrelated
  commands look like a single control.
- Grouped controls must expose a group label and keyboard model.

### Chips

- Use `Tag` for taxonomy, `Status` for state, `FilterChip` for a pressed
  filter, and `Token` for a removable value.
- A removable token uses a real nested button with an accessible remove label;
  it must not use a span with `role="button"`.

### Menus and layers

- Menus own focus, Escape dismissal, selection semantics, and return focus.
- Dialogs and sheets own focus trapping, initial focus, Escape, and return focus.
- Feature code supplies content and intent, not independent layer behavior.

### Fields and controls

- `Field` owns the label relationship, required state, hint, and error wiring.
- Inputs, selects, and textareas consume Field context where applicable.
- Errors describe the correction needed.
- Read-only and disabled are distinct states.

### Status, feedback, and emptiness

- Use `Alert` for persistent feedback that requires context or action.
- Use `Toast` for short-lived completion feedback.
- Use `Spinner` for brief indefinite work and `Progress` for measurable work.
  Standalone spinners announce only when a meaningful label is supplied;
  decorative/in-button spinners are hidden from the accessibility tree.
- Empty states explain what is absent and provide a next action when one exists.

### Menu items

- Simple menu items can render children directly.
- Slotted menu items may provide `leading`, `description`, `shortcut`, and
  `trailing` content; the component owns their alignment and truncation.

### Inputs

- `Input` consumes Field context for labels, descriptions, errors, and IDs.
- Read-only is represented separately from disabled with `aria-readonly` and a
  base-surface treatment.
- `Select` and `Textarea` consume the same Field context and native form
  semantics; their visual treatment should not introduce a feature wrapper.
- `Checkbox` keeps its full label and description in one hit area. Use a
  surrounding `Field` when the label belongs to a larger form rhythm.
- `RadioGroup` is a named native radio set. Use arrow keys for movement and
  expose a group label whenever the surrounding context does not already name
  it.
- `SearchField` is for filtering or finding within a surface. Keep clear and
  shortcut affordances inside the control and provide an accessible label.
- `FormLayout` controls columns and rhythm only; it is not a card or panel
  wrapper. Collapse columns before text or controls become cramped.

## Intentional exceptions

Exceptions are allowed when the native or feature-specific behavior is the
meaningful part of the surface. Each exception should be documented next to the
feature and should not duplicate Fiber behavior accidentally.

Current exception categories:

- Milkdown/ProseMirror editor controls rendered outside normal React trees.
- Native file inputs used to invoke the browser file picker.
- Native date, color, and checkbox inputs where browser semantics are valuable
  and a Fiber equivalent is not yet available.
- Specialized workout measurement controls that need domain-specific parsing.
- Dockview-managed tabs and panel chrome whose interaction model belongs to the
  dockview host.

Raw controls in new UI require either a Fiber primitive or an explicit entry in
this exception list. The Fiber maintainers own this list until a feature has a
named owner in its local documentation.

## Phase 1 acceptance checklist

- [x] Every supported theme defines the typography roles.
- [x] Every component can inherit density without a feature-specific fourth
      value.
- [x] New feature CSS uses semantic surface, border, state, and elevation
      aliases.
- [x] Default token values preserve the current UI until component migration
      begins.
- [x] New exceptions are documented with their reason and owner.
- [x] Baseline view captures are recorded before Phase 2 visual migration.
