import { useState } from 'react'
import { Check, CircleDot, FlaskConical, Plus, Sparkles, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  ActionGroup,
  BackLink,
  Breadcrumbs,
  Button,
  ButtonLink,
  Checkbox,
  Chip,
  Dialog,
  EmptyState,
  FilterChip,
  Field,
  FormLayout,
  IconButton,
  Input,
  ListRow,
  Menu,
  MenuItem,
  Popover,
  Progress,
  RadioGroup,
  SearchField,
  SegmentedControl,
  Select,
  SectionHeader,
  Sheet,
  Skeleton,
  Spinner,
  Status,
  Tabs,
  Tag,
  Textarea,
  Token,
  Tooltip,
  ToggleButton,
  ToggleGroup,
  Toast,
  Toolbar,
  type ButtonVariant,
} from 'fiber'

const BUTTON_VARIANTS: ButtonVariant[] = ['solid', 'accent', 'outline', 'ghost', 'danger']
const CHIP_ACCENTS = ['thread', 'task', 'idea', 'question', 'decision', 'danger', 'neutral'] as const

const COMPONENTS = [
  { id: 'button', label: 'Button', group: 'Actions', description: 'The shared action primitive for commands, forms, and primary moments.' },
  { id: 'field', label: 'Field', group: 'Forms', description: 'A labeled control shell that wires hints, errors, and required state together.' },
  { id: 'input', label: 'Input', group: 'Forms', description: 'A density-aware text control that inherits Fiber focus, disabled, and validation behavior.' },
  { id: 'select', label: 'Select', group: 'Forms', description: 'A native choice control with the same Field wiring and compact visual treatment.' },
  { id: 'textarea', label: 'Textarea', group: 'Forms', description: 'A multi-line control for context and notes without a separate feature recipe.' },
  { id: 'checkbox', label: 'Checkbox', group: 'Forms', description: 'A clear binary choice with a full-label hit area and optional supporting copy.' },
  { id: 'radio-group', label: 'RadioGroup', group: 'Forms', description: 'A native single-choice group that keeps arrow-key behavior predictable.' },
  { id: 'search-field', label: 'SearchField', group: 'Forms', description: 'A focused search recipe that keeps icon, shortcut, and clear affordances in one control.' },
  { id: 'form-layout', label: 'FormLayout', group: 'Forms', description: 'A responsive field grid that applies one rhythm across settings and inspectors.' },
  { id: 'segmented-control', label: 'SegmentedControl', group: 'Navigation', description: 'Mutually exclusive choices with native radio semantics and predictable arrow-key movement.' },
  { id: 'toggle-group', label: 'ToggleGroup', group: 'Navigation', description: 'Single- or multi-select toggles with roving focus and explicit checked state.' },
  { id: 'tabs', label: 'Tabs', group: 'Navigation', description: 'Panel navigation with one selected tab, one focus stop, and explicit tab-to-panel relationships.' },
  { id: 'toolbar', label: 'Toolbar', group: 'Actions', description: 'A responsive alignment rail for action priority, filters, and view controls.' },
  { id: 'breadcrumbs', label: 'Breadcrumbs', group: 'Navigation', description: 'A compact page hierarchy with a reliable current-page marker.' },
  { id: 'back-link', label: 'BackLink', group: 'Navigation', description: 'A low-emphasis return link with a consistent leading affordance.' },
  { id: 'action-group', label: 'ActionGroup', group: 'Actions', description: 'A single spacing contract for related commands without hiding their priority or meaning.' },
  { id: 'list-row', label: 'ListRow', group: 'Rows', description: 'A dense row recipe for scannable titles, metadata, status, and trailing actions.' },
  { id: 'tooltip', label: 'Tooltip', group: 'Feedback', description: 'Quiet hover and focus context for icon actions and abbreviated metadata.' },
  { id: 'section-header', label: 'SectionHeader', group: 'Rows', description: 'Compact section hierarchy with optional description, metadata, and actions.' },
  { id: 'button-link', label: 'ButtonLink', group: 'Navigation', description: 'Router-aware navigation that carries the same visual language as a button.' },
  { id: 'icon-button', label: 'IconButton', group: 'Compact action', description: 'An icon-only action with a consistent hit target and an explicit accessible label.' },
  { id: 'toggle-button', label: 'ToggleButton', group: 'Stateful action', description: 'A pressed-state button for view modes, filters, and persistent choices.' },
  { id: 'menu-item', label: 'MenuItem', group: 'Menus', description: 'A menu action with shared density, focus treatment, and disabled behavior.' },
  { id: 'popover', label: 'Popover', group: 'Layers', description: 'A positioned surface with outside-click, Escape, and focus-return behavior.' },
  { id: 'menu', label: 'Menu', group: 'Layers', description: 'A keyboard-navigable action menu built on the shared popover contract.' },
  { id: 'dialog', label: 'Dialog', group: 'Layers', description: 'A focus-managed modal with structured header, body, footer, and dismissal.' },
  { id: 'sheet', label: 'Sheet', group: 'Layers', description: 'An edge-anchored panel that shares modal focus behavior and adapts on mobile.' },
  { id: 'chip', label: 'Chip', group: 'Labels and filters', description: 'A semantic label for tags, statuses, and lightweight filtering.' },
  { id: 'spinner', label: 'Spinner', group: 'Feedback', description: 'An announced loading indicator that works inline or in a quiet status surface.' },
  { id: 'alert', label: 'Alert', group: 'Feedback', description: 'Persistent status messaging with tone-specific live-region semantics.' },
  { id: 'toast', label: 'Toast', group: 'Feedback', description: 'Transient async feedback with polite announcements and optional auto-dismiss.' },
  { id: 'progress', label: 'Progress', group: 'Feedback', description: 'Measurable or indeterminate progress with a stable progressbar contract.' },
  { id: 'skeleton', label: 'Skeleton', group: 'Feedback', description: 'A restrained loading placeholder for layouts whose final geometry is predictable.' },
  { id: 'empty-state', label: 'EmptyState', group: 'Empty moments', description: 'A calm invitation for views that have not received their first item yet.' },
] as const

type ComponentId = typeof COMPONENTS[number]['id']

function isComponentId(value: string | null): value is ComponentId {
  return COMPONENTS.some((component) => component.id === value)
}

export function FiberGallery({ hidden }: { hidden: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [pressed, setPressed] = useState(true)
  const [menuChoice, setMenuChoice] = useState('Open thread')
  const [chipRemoved, setChipRemoved] = useState(false)
  const [tokenRemoved, setTokenRemoved] = useState(false)
  const [radioChoice, setRadioChoice] = useState('focused')
  const [searchValue, setSearchValue] = useState('')
  const [segmentChoice, setSegmentChoice] = useState('today')
  const [toggleChoice, setToggleChoice] = useState('today')
  const [tabChoice, setTabChoice] = useState('overview')
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [alertVisible, setAlertVisible] = useState(true)
  const [toastVisible, setToastVisible] = useState(true)

  const requestedComponent = searchParams.get('component')
  const selectedId: ComponentId = isComponentId(requestedComponent) ? requestedComponent : 'button'
  const selected = COMPONENTS.find((component) => component.id === selectedId) ?? COMPONENTS[0]

  function selectComponent(id: ComponentId) {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('component', id)
    setSearchParams(nextParams)
  }

  function renderComponentDetail() {
    switch (selectedId) {
      case 'button':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Variants</span>
              <div className="fiber-button-row">
                {BUTTON_VARIANTS.map((variant) => <Button key={variant} variant={variant}>{variant}</Button>)}
              </div>
            </div>
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Sizes and states</span>
              <div className="fiber-button-row">
                <Button size="sm">Small</Button>
                <Button size="lg">Large</Button>
                <Button loading>Saving</Button>
                <Button disabled>Disabled</Button>
                <Button><Plus size={15} /> With icon</Button>
              </div>
            </div>
            <p className="fiber-detail-note">Every variant preserves the same focus ring, loading contract, disabled behavior, and keyboard semantics.</p>
          </div>
        )
      case 'field':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Complete field</span>
              <Field label="Workspace name" hint="Shown in your local workspace header." controlId="fiber-workspace-name" required>
                <Input defaultValue="Daily review" />
              </Field>
            </div>
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Validation and disabled states</span>
              <div className="fiber-field-demo-grid">
                <Field label="Feed URL" error="Enter a complete URL, including https://" controlId="fiber-feed-url">
                  <Input defaultValue="thread.local" />
                </Field>
                <Field label="Read-only workspace" hint="This value is managed elsewhere." controlId="fiber-read-only">
                  <Input defaultValue="Personal" readOnly />
                </Field>
              </div>
            </div>
            <p className="fiber-detail-note">Field owns the label relationship and connects its hint or error to the control with aria-describedby.</p>
          </div>
        )
      case 'input':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Control states</span>
              <div className="fiber-field-demo-grid">
                <Field label="Search notes" controlId="fiber-search-input">
                  <Input placeholder="Search notes…" />
                </Field>
                <Field label="Invalid value" error="That value needs attention." controlId="fiber-invalid-input">
                  <Input defaultValue="Needs review" invalid />
                </Field>
              </div>
            </div>
            <p className="fiber-detail-note">Use Input for a single-line value. It carries Fiber's 44px target, focus ring, disabled opacity, and invalid border.</p>
          </div>
        )
      case 'select':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Native choice</span>
              <Field label="Workspace mode" hint="Choose how this workspace opens." controlId="fiber-select-mode">
                <Select defaultValue="review">
                  <option value="review">Review</option>
                  <option value="focus">Focus</option>
                  <option value="quiet">Quiet</option>
                </Select>
              </Field>
            </div>
            <p className="fiber-detail-note">Select keeps native keyboard and screen-reader behavior while inheriting Fiber's compact surface and focus ring.</p>
          </div>
        )
      case 'textarea':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Multi-line context</span>
              <Field label="Context" hint="Keep this short and useful." controlId="fiber-textarea-context">
                <Textarea defaultValue="Capture the decision and the next action." rows={3} />
              </Field>
            </div>
            <p className="fiber-detail-note">Textarea shares label, hint, error, density, and validation behavior with Input.</p>
          </div>
        )
      case 'checkbox':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Binary choices</span>
              <div className="fiber-check-demo">
                <Checkbox label="Pin to sidebar" description="Keep this workspace one click away." defaultChecked />
                <Checkbox label="Send a reminder" description="Notify me when the review is due." />
                <Checkbox label="Unavailable option" disabled />
              </div>
            </div>
            <p className="fiber-detail-note">The label and supporting copy stay together, while the input remains a native checkbox for predictable keyboard behavior.</p>
          </div>
        )
      case 'radio-group':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Single choice</span>
              <RadioGroup
                label="Editor density"
                hint="You can change this later in Settings."
                name="fiber-density"
                value={radioChoice}
                onValueChange={setRadioChoice}
                orientation="horizontal"
                options={[
                  { value: 'compact', label: 'Compact' },
                  { value: 'focused', label: 'Focused' },
                  { value: 'comfortable', label: 'Comfortable' },
                ]}
              />
            </div>
            <p className="fiber-detail-note">RadioGroup uses native radios so arrow keys move through one named set without custom roving-focus code.</p>
          </div>
        )
      case 'search-field':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Dense list filter</span>
              <SearchField value={searchValue} onChange={(event) => setSearchValue(event.target.value)} clearable onClear={() => setSearchValue('')} shortcut="⌘K" />
            </div>
            <p className="fiber-detail-note">Search keeps the icon and shortcut inside the control, so a toolbar does not need another wrapper or explanatory label.</p>
          </div>
        )
      case 'form-layout':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Responsive field rhythm</span>
              <FormLayout columns={2} density="compact">
                <Field label="First name" controlId="fiber-first-name"><Input defaultValue="Mayank" /></Field>
                <Field label="Last name" controlId="fiber-last-name"><Input defaultValue="Kushal" /></Field>
                <Field label="Workspace" controlId="fiber-workspace"><Select defaultValue="personal"><option value="personal">Personal</option><option value="team">Team</option></Select></Field>
                <Field label="Notes" controlId="fiber-notes"><Input placeholder="Optional" /></Field>
              </FormLayout>
            </div>
            <p className="fiber-detail-note">FormLayout is a grid, not a card system: fields align when space allows and collapse to one column before they become cramped.</p>
          </div>
        )
      case 'segmented-control':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Mutually exclusive choices</span>
              <SegmentedControl
                density="compact"
                aria-label="Review scope"
                value={segmentChoice}
                onValueChange={setSegmentChoice}
                options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'all', label: 'All time' }]}
              />
            </div>
            <p className="fiber-detail-note">SegmentedControl owns one selected value, exposes radio semantics, and moves between enabled choices with the arrow keys.</p>
          </div>
        )
      case 'toggle-group':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Single-select toggles</span>
              <ToggleGroup
                aria-label="Review scope"
                value={toggleChoice}
                onValueChange={(value) => { if (typeof value === 'string') setToggleChoice(value) }}
                options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'all', label: 'All time' }]}
              />
            </div>
            <p className="fiber-detail-note">ToggleGroup supports both single-select radio semantics and multi-select checkbox semantics while keeping arrow-key movement predictable.</p>
          </div>
        )
      case 'tabs':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Panel navigation</span>
              <Tabs
                aria-label="Workspace view"
                value={tabChoice}
                onValueChange={setTabChoice}
                options={[{ value: 'overview', label: 'Overview' }, { value: 'activity', label: 'Activity' }, { value: 'settings', label: 'Settings' }]}
              />
            </div>
            <p className="fiber-detail-note">Tabs reserve arrow-key movement for related panels and expose the active tab through aria-selected.</p>
          </div>
        )
      case 'toolbar':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Action rail</span>
              <Toolbar label="Review actions" density="compact">
                <SearchField placeholder="Filter items" />
                <SegmentedControl aria-label="Scope" value="today" options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }]} />
                <ActionGroup density="compact"><Button variant="solid">New item</Button><Button variant="ghost">More</Button></ActionGroup>
              </Toolbar>
            </div>
            <p className="fiber-detail-note">Toolbar is the shared alignment rail; ActionGroup remains the boundary for related commands with a clear priority.</p>
          </div>
        )
      case 'breadcrumbs':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Page hierarchy</span>
              <Breadcrumbs items={[{ label: 'Workspace', href: '#' }, { label: 'Projects', href: '#' }, { label: 'Fiber UI', current: true }]} />
            </div>
            <p className="fiber-detail-note">Breadcrumbs keeps the current page explicit for both sighted users and assistive technology.</p>
          </div>
        )
      case 'back-link':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Return navigation</span>
              <BackLink href="#">Back to projects</BackLink>
            </div>
            <p className="fiber-detail-note">BackLink is intentionally quiet: use it for return navigation, while ButtonLink carries an action or destination with more visual weight.</p>
          </div>
        )
      case 'action-group':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Related commands</span>
              <ActionGroup density="compact">
                <Button variant="solid">Save changes</Button>
                <Button variant="outline">Preview</Button>
                <Button variant="ghost">Cancel</Button>
              </ActionGroup>
            </div>
            <p className="fiber-detail-note">ActionGroup owns rhythm and wrapping; each action still carries its own emphasis, label, and native behavior.</p>
          </div>
        )
      case 'list-row':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Dense content rows</span>
              <div className="fiber-list-demo">
                <ListRow
                  leading={<CircleDot size={14} />}
                  title="Review the launch notes"
                  status="In progress"
                  description="Capture the final decision and the next action."
                  meta={<><span>Today</span><span>3 comments</span></>}
                  trailing={<Button variant="ghost" size="sm">Open</Button>}
                  selected
                />
                <ListRow
                  leading={<Check size={14} />}
                  title="Archive the old draft"
                  description="A quieter row keeps the list easy to scan."
                  meta={<span>Yesterday</span>}
                  trailing={<span className="fiber-state-note">Done</span>}
                  density="compact"
                />
              </div>
            </div>
            <p className="fiber-detail-note">ListRow owns alignment, density, selection, and focus treatment. Use the interactive form for a single-action row; keep trailing controls in a static row to avoid nested buttons.</p>
          </div>
        )
      case 'button-link':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Navigation actions</span>
              <div className="fiber-button-row">
                <ButtonLink to="?component=button-link" variant="outline">Stay in Fiber</ButtonLink>
                <ButtonLink to="?component=button" variant="ghost">Button detail</ButtonLink>
              </div>
            </div>
            <p className="fiber-detail-note">Use ButtonLink when the action changes the route. It renders a real anchor while sharing Button's visual contract.</p>
          </div>
        )
      case 'icon-button':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Compact actions</span>
              <div className="fiber-icon-row">
                <IconButton aria-label="Add item"><Plus size={17} /></IconButton>
                <IconButton variant="outline" aria-label="Mark complete"><Check size={17} /></IconButton>
                <IconButton variant="danger" aria-label="Remove item"><X size={17} /></IconButton>
              </div>
            </div>
            <p className="fiber-detail-note">The required aria-label keeps icon-only actions discoverable to assistive technology.</p>
          </div>
        )
      case 'toggle-button':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Pressed state</span>
              <div className="fiber-button-row">
                <ToggleButton variant="outline" pressed={pressed} onClick={() => setPressed((value) => !value)}>{pressed ? 'Pinned' : 'Pin this'}</ToggleButton>
                <span className="fiber-state-note"><CircleDot size={13} /> {pressed ? 'pressed' : 'not pressed'}</span>
              </div>
            </div>
            <p className="fiber-detail-note">The current value is exposed through aria-pressed, so visual state and semantic state cannot drift apart.</p>
          </div>
        )
      case 'menu-item':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Menu behavior</span>
              <div className="menu-panel fiber-menu-demo" role="menu" aria-label="Fiber menu example">
                <MenuItem leading={<CircleDot size={13} />} trailing={menuChoice === 'Open thread' ? <Check size={13} /> : undefined} onClick={() => setMenuChoice('Open thread')} className={menuChoice === 'Open thread' ? 'active' : undefined}>Open thread</MenuItem>
                <MenuItem leading={<CircleDot size={13} />} trailing={menuChoice === 'Duplicate' ? <Check size={13} /> : undefined} onClick={() => setMenuChoice('Duplicate')} className={menuChoice === 'Duplicate' ? 'active' : undefined}>Duplicate</MenuItem>
                <MenuItem description="Unavailable" disabled>Archive</MenuItem>
              </div>
              <span className="fiber-state-note">Selected: {menuChoice}</span>
            </div>
            <p className="fiber-detail-note">MenuItem composes the shared button behavior with the 44px menu hit area and active/disabled states.</p>
          </div>
        )
      case 'popover':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Positioned detail</span>
              <Popover
                open={popoverOpen}
                onOpenChange={setPopoverOpen}
                trigger={<Button variant="outline">{popoverOpen ? 'Hide details' : 'Show details'}</Button>}
              >
                <div className="fiber-popover-demo"><strong>Current view</strong><span>Review items due this week.</span></div>
              </Popover>
            </div>
            <p className="fiber-detail-note">Popover owns outside-click dismissal, Escape handling, and focus return while leaving its content composition open.</p>
          </div>
        )
      case 'menu':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Action menu</span>
              <Menu open={menuOpen} onOpenChange={setMenuOpen} trigger={<Button variant="outline">{menuOpen ? 'Close menu' : 'Open menu'}</Button>}>
                <MenuItem onClick={() => setMenuChoice('Open thread')}>Open thread</MenuItem>
                <MenuItem onClick={() => setMenuChoice('Duplicate')}>Duplicate</MenuItem>
                <MenuItem disabled>Archive</MenuItem>
              </Menu>
              <span className="fiber-state-note">Last choice: {menuChoice}</span>
            </div>
            <p className="fiber-detail-note">Menu adds arrow-key navigation and closes after activation on top of the shared Popover contract.</p>
          </div>
        )
      case 'dialog':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Focus-managed modal</span>
              <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
              <Dialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                title="Save this view?"
                description="Your filters will be available the next time you open this workspace."
                footer={<ActionGroup density="compact"><Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button><Button onClick={() => setDialogOpen(false)}>Save view</Button></ActionGroup>}
              >
                <p className="fiber-detail-note">The dialog traps focus, closes with Escape, and restores focus to its trigger.</p>
              </Dialog>
            </div>
            <p className="fiber-detail-note">Dialog provides structured title, description, body, footer, initial focus, backdrop dismissal, and focus return.</p>
          </div>
        )
      case 'sheet':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Edge panel</span>
              <Button variant="outline" onClick={() => setSheetOpen(true)}>Open sheet</Button>
              <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title="View details" description="A wider surface for contextual information." footer={<Button onClick={() => setSheetOpen(false)}>Done</Button>}>
                <div className="fiber-detail-content"><Skeleton variant="text" lines={3} width="80%" /><p>Sheets adapt to an end panel on desktop and a bottom sheet when the layout calls for it.</p></div>
              </Sheet>
            </div>
            <p className="fiber-detail-note">Sheet shares Dialog's focus and dismissal behavior while supporting start, end, and bottom placement.</p>
          </div>
        )
      case 'chip':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Semantic labels</span>
              <div className="fiber-chip-row"><Tag accent="thread">Tag</Tag><Status accent="task">Status</Status><FilterChip accent="thread" pressed>Filter</FilterChip>{tokenRemoved ? <Button variant="ghost" size="sm" onClick={() => setTokenRemoved(false)}>Restore token</Button> : <Token accent="neutral" onRemove={() => setTokenRemoved(true)}>Token</Token>}</div>
              <span className="fiber-demo-label">Accent tokens</span>
              <div className="fiber-chip-row">{CHIP_ACCENTS.map((accent) => <Chip key={accent} accent={accent}>{accent}</Chip>)}</div>
            </div>
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Interactive chip</span>
              <div className="fiber-chip-row">
                {chipRemoved ? <Button variant="ghost" size="sm" onClick={() => setChipRemoved(false)}>Restore removable chip</Button> : <Chip interactive accent="thread" icon={<Sparkles size={12} />} onRemove={() => setChipRemoved(true)}>Removable</Chip>}
              </div>
            </div>
            <p className="fiber-detail-note">Semantic APIs keep tags, statuses, filters, and removable values clear while sharing one restrained visual language.</p>
          </div>
        )
      case 'spinner':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Loading indicators</span>
              <div className="fiber-spinner-row"><Spinner size={18} /><Spinner size={24} label="Syncing workspace" /></div>
            </div>
            <p className="fiber-detail-note">Spinner announces itself as a status and works at multiple sizes without changing surrounding layout.</p>
          </div>
        )
      case 'alert':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Persistent feedback</span>
              {alertVisible ? <Alert variant="success" title="Saved locally" onDismiss={() => setAlertVisible(false)}>Your changes are ready to sync.</Alert> : <Button variant="ghost" size="sm" onClick={() => setAlertVisible(true)}>Restore alert</Button>}
            </div>
            <p className="fiber-detail-note">Alert chooses polite or assertive live-region behavior from its tone and supports optional actions or dismissal.</p>
          </div>
        )
      case 'toast':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Transient feedback</span>
              {toastVisible ? <Toast variant="info" durationMs={0} onDismiss={() => setToastVisible(false)}>Sync queued for the next connection.</Toast> : <Button variant="ghost" size="sm" onClick={() => setToastVisible(true)}>Show toast</Button>}
            </div>
            <p className="fiber-detail-note">Toast is a leaf notification surface with polite announcements, an optional timeout, action slot, and explicit dismissal.</p>
          </div>
        )
      case 'progress':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Measured and indeterminate</span>
              <Progress value={64} label="Importing notes" showValue />
              <Progress label="Preparing workspace" size="sm" />
            </div>
            <p className="fiber-detail-note">Progress exposes value, bounds, and a readable value text when work is measurable, while undefined value selects the indeterminate treatment.</p>
          </div>
        )
      case 'skeleton':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Predictable loading layout</span>
              <div className="fiber-skeleton-demo"><Skeleton variant="circle" /><Skeleton variant="text" lines={3} width="70%" /><Skeleton variant="block" width="100%" /></div>
            </div>
            <p className="fiber-detail-note">Skeleton stays reserved for content whose final geometry is known, keeping loading states calm and preventing layout jumps.</p>
          </div>
        )
      case 'tooltip':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Context on hover or focus</span>
              <div className="fiber-tooltip-demo">
                <Tooltip content="Add a new item">
                  <IconButton aria-label="Add a new item"><Plus size={17} /></IconButton>
                </Tooltip>
                <Tooltip content="This action keeps the current view open." side="right">
                  <Button variant="outline">Keep this view</Button>
                </Tooltip>
              </div>
            </div>
            <p className="fiber-detail-note">Tooltip adds short context to a native trigger on pointer hover and keyboard focus. Use it for icon actions or abbreviated metadata, not for essential instructions.</p>
          </div>
        )
      case 'section-header':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Quiet hierarchy</span>
              <div className="fiber-section-header-demo">
                <SectionHeader
                  title={<h3>Workout history</h3>}
                  description="Review recent sessions and keep the next one moving."
                  meta="8 sessions"
                  actions={<Button variant="outline" size="sm">View all</Button>}
                />
              </div>
            </div>
            <p className="fiber-detail-note">SectionHeader aligns a section’s title, supporting description, metadata, and actions without adding a decorative eyebrow or a second wrapper recipe.</p>
          </div>
        )
      case 'empty-state':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block fiber-empty-demo">
              <EmptyState variant="panel" icon={<FlaskConical size={24} />} title="Nothing here yet" hint="Add a first item to give this view a little signal." action={<Button size="sm">Add item</Button>} />
            </div>
            <p className="fiber-detail-note">EmptyState turns a blank surface into a clear next step with optional iconography and guidance.</p>
          </div>
        )
    }
  }

  return (
    <section className="settings-category fiber-gallery" hidden={hidden} aria-labelledby="settings-category-fiber">
      <h1 id="settings-category-fiber" className="sr-only">Fiber UI library</h1>

      <div className="fiber-browser">
        <aside className="fiber-component-nav" aria-label="Fiber components">
          <div className="fiber-component-nav-head"><span>Components</span><strong>{COMPONENTS.length}</strong></div>
          <nav className="fiber-component-nav-list" aria-label="Choose a component">
            {COMPONENTS.map((component) => (
              <Button
                key={component.id}
                unstyled
                type="button"
                className={selectedId === component.id ? 'is-active' : undefined}
                aria-current={selectedId === component.id ? 'page' : undefined}
                onClick={() => selectComponent(component.id)}
              >
                <span className="fiber-component-nav-dot" aria-hidden="true" />
                <span className="fiber-component-nav-label">{component.label}</span>
              </Button>
            ))}
          </nav>
        </aside>

        <article className="fiber-detail" aria-labelledby="fiber-detail-title">
          <header className="fiber-detail-header">
            <div>
              <span className="fiber-kicker">{selected.group}</span>
              <h3 id="fiber-detail-title">{selected.label}</h3>
              <p>{selected.description}</p>
            </div>
            <code>fiber/{selected.id}</code>
          </header>
          <div className="fiber-detail-stage">{renderComponentDetail()}</div>
        </article>
      </div>
    </section>
  )
}
