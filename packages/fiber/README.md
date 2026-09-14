# Fiber

Fiber is Thread's shared UI component library. Import primitives from `fiber` and load the package stylesheet once from the app entrypoint:

```tsx
import { Alert, Button, ButtonLink, Chip, Dialog, EmptyState, Field, IconButton, Input, Menu, MenuItem, Popover, Progress, Sheet, Spinner, ToggleButton, Toolbar } from 'fiber'
import 'fiber/styles.css'
```

The package also exports `createButtonElement()` for editor surfaces that render outside React.

For text entry, compose `Field` and `Input` so labels, required markers, hints, and validation stay
consistent:

```tsx
<Field label="Workspace name" hint="Shown in your workspace header." required>
  <Input value={name} onChange={(event) => setName(event.target.value)} />
</Field>
```

The package is intentionally source-exported inside the Thread workspace so component changes are available to the app immediately and remain easy to inspect. The standalone `fiber.html` page is the living component catalog.

Navigation, layers, and feedback primitives are available alongside the original controls: use `Toolbar` and `ToggleGroup` for action rails, `Popover`/`Menu` for transient surfaces, `Dialog`/`Sheet` for focus-managed layers, and `Alert`/`Toast`/`Progress`/`Skeleton` for status and loading states.
