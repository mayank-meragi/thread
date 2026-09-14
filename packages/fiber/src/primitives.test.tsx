import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button } from './Button'
import { ActionGroup } from './ActionGroup'
import { Alert } from './Alert'
import { BackLink } from './BackLink'
import { Breadcrumbs } from './Breadcrumbs'
import { Checkbox } from './Checkbox'
import { Chip, FilterChip, Token } from './Chip'
import { Dialog } from './Dialog'
import { EmptyState } from './EmptyState'
import { Field } from './Field'
import { FormLayout } from './FormLayout'
import { Input } from './Input'
import { Menu } from './Menu'
import { MenuItem } from './MenuItem'
import { ListRow } from './ListRow'
import { Popover } from './Popover'
import { Progress } from './Progress'
import { RadioGroup } from './RadioGroup'
import { SearchField } from './SearchField'
import { SegmentedControl } from './SegmentedControl'
import { SectionHeader } from './SectionHeader'
import { Select } from './Select'
import { Sheet } from './Sheet'
import { Skeleton } from './Skeleton'
import { Spinner } from './Spinner'
import { Tabs } from './Tabs'
import { ToggleGroup } from './ToggleGroup'
import { Toast } from './Toast'
import { Toolbar } from './Toolbar'
import { Textarea } from './Textarea'
import { Tooltip } from './Tooltip'

describe('Fiber primitive contracts', () => {
  it('keeps a loading button label visible while exposing busy state', () => {
    const markup = renderToStaticMarkup(<Button loading>Saving</Button>)

    expect(markup).toContain('Saving')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('aria-hidden="true"')
  })

  it('only announces standalone spinners when a label is provided', () => {
    const silent = renderToStaticMarkup(<Spinner />)
    const announced = renderToStaticMarkup(<Spinner label="Syncing workspace" />)

    expect(silent).toContain('aria-hidden="true"')
    expect(silent).not.toContain('role="status"')
    expect(announced).toContain('role="status"')
    expect(announced).toContain('Syncing workspace')
  })

  it('wires Field labels and hints to the Input control', () => {
    const markup = renderToStaticMarkup(
      <Field label="Workspace name" hint="Shown in the header." controlId="workspace-name">
        <Input />
      </Field>,
    )

    expect(markup).toContain('for="workspace-name"')
    expect(markup).toContain('id="workspace-name"')
    expect(markup).toContain('aria-describedby="workspace-name-hint"')
  })

  it('renders structured menu slots without changing the native button contract', () => {
    const markup = renderToStaticMarkup(
      <MenuItem leading="•" description="Open the current thread" shortcut="⌘K" trailing="→">
        Open thread
      </MenuItem>,
    )

    expect(markup).toContain('menu-item-slotted')
    expect(markup).toContain('menu-item-description')
    expect(markup).toContain('menu-item-trailing')
    expect(markup).toContain('Open thread')
  })

  it('keeps semantic chips distinct and gives tokens a real remove button', () => {
    const markup = renderToStaticMarkup(
      <div>
        <Chip>Label</Chip>
        <FilterChip pressed>Filter</FilterChip>
        <Token onRemove={() => undefined}>Value</Token>
      </div>,
    )

    expect(markup).toContain('chip-filter')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('chip-token')
    expect(markup).toContain('aria-label="Remove"')
    expect(markup.match(/<button/g)?.length).toBe(2)
  })

  it('supports compact empty-state variants with a next action', () => {
    const markup = renderToStaticMarkup(
      <EmptyState variant="inline" title="No results" hint="Try another search." action={<Button size="sm">Clear</Button>} />,
    )

    expect(markup).toContain('empty-state-inline')
    expect(markup).toContain('empty-state-action')
    expect(markup).toContain('Clear')
  })

  it('wires Select and Textarea into Field metadata', () => {
    const markup = renderToStaticMarkup(
      <div>
        <Field label="Mode" hint="Choose one." controlId="mode"><Select defaultValue="focus"><option value="focus">Focus</option></Select></Field>
        <Field label="Notes" error="Add a little context." controlId="notes"><Textarea defaultValue="Draft" /></Field>
      </div>,
    )

    expect(markup).toContain('class="field-control field-select"')
    expect(markup).toContain('id="mode"')
    expect(markup).toContain('aria-describedby="mode-hint"')
    expect(markup).toContain('class="field-control field-textarea"')
    expect(markup).toContain('aria-describedby="notes-error"')
  })

  it('renders labeled checkboxes and native radio groups', () => {
    const markup = renderToStaticMarkup(
      <div>
        <Checkbox label="Pin workspace" description="Keep it nearby." defaultChecked />
        <RadioGroup label="Density" name="density" defaultValue="compact" options={[{ value: 'compact', label: 'Compact' }, { value: 'default', label: 'Default' }]} />
      </div>,
    )

    expect(markup).toContain('type="checkbox"')
    expect(markup).toContain('Pin workspace')
    expect(markup).toContain('Keep it nearby.')
    expect(markup).toContain('type="radio"')
    expect(markup).toContain('name="density"')
  })

  it('keeps SearchField affordances inside one control and exposes a form grid', () => {
    const markup = renderToStaticMarkup(
      <FormLayout columns={2} density="compact">
        <SearchField value="thread" clearable onClear={() => undefined} />
        <Input placeholder="Notes" />
      </FormLayout>,
    )

    expect(markup).toContain('form-layout-2')
    expect(markup).toContain('data-density="compact"')
    expect(markup).toContain('type="search"')
    expect(markup).toContain('aria-label="Clear search"')

    const labeledMarkup = renderToStaticMarkup(<Field label="Search notes" controlId="search-notes"><SearchField /></Field>)
    expect(labeledMarkup).not.toContain('aria-label="Search"')
    expect(labeledMarkup).toContain('id="search-notes"')
  })

  it('renders segmented choices as one keyboard-navigable radio group', () => {
    const markup = renderToStaticMarkup(
      <SegmentedControl aria-label="Scope" value="week" density="compact" options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'all', label: 'All time', disabled: true }]} />,
    )

    expect(markup).toContain('role="radiogroup"')
    expect(markup).toContain('aria-label="Scope"')
    expect(markup).toContain('data-density="compact"')
    expect(markup).toContain('role="radio"')
    expect(markup).toContain('aria-checked="true"')
    expect(markup).toContain('disabled=""')
  })

  it('connects tabs to their panels and keeps one tab in the tab sequence', () => {
    const markup = renderToStaticMarkup(
      <Tabs aria-label="Views" value="activity" idPrefix="view-tab" panelId="view-panel" options={[{ value: 'overview', label: 'Overview' }, { value: 'activity', label: 'Activity' }]} />,
    )

    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('role="tab"')
    expect(markup).toContain('id="view-tab-activity"')
    expect(markup).toContain('aria-controls="view-panel"')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('tabindex="0"')
    expect(markup).toContain('tabindex="-1"')
  })

  it('keeps action groups structural so each command retains its own emphasis', () => {
    const markup = renderToStaticMarkup(<ActionGroup density="compact" align="end"><Button>Save</Button><Button variant="ghost">Cancel</Button></ActionGroup>)

    expect(markup).toContain('class="action-group action-group-end"')
    expect(markup).toContain('data-density="compact"')
    expect(markup).toContain('Save')
    expect(markup).toContain('Cancel')
  })

  it('renders dense rows with slots and native activation semantics', () => {
    const markup = renderToStaticMarkup(
      <ListRow
        title="Review notes"
        description="Capture the decision and next action."
        meta={<time dateTime="2026-09-14">Today</time>}
        status="In progress"
        leading="•"
        trailing="Open"
        selected
        density="compact"
        onActivate={() => undefined}
      />,
    )

    expect(markup).toContain('list-row list-row-interactive is-selected')
    expect(markup).toContain('data-density="compact"')
    expect(markup).toContain('list-row-status')
    expect(markup).toContain('Review notes')
    expect(markup).toContain('<button')
  })

  it('describes tooltip triggers without replacing their native semantics', () => {
    const markup = renderToStaticMarkup(
      <Tooltip content="Hide the context panel" side="right">
        <button type="button" aria-label="Hide context panel">×</button>
      </Tooltip>,
    )

    expect(markup).toContain('class="tooltip"')
    expect(markup).toContain('data-side="right"')
    expect(markup).toContain('role="tooltip"')
    expect(markup).toContain('aria-describedby="fiber-tooltip-')
    expect(markup).toContain('class="tooltip-trigger"')
  })

  it('keeps section titles, metadata, and actions in one alignment contract', () => {
    const markup = renderToStaticMarkup(
      <SectionHeader
        title={<h3>Subtasks</h3>}
        description="Keep the next action visible."
        meta="3"
        actions={<Button size="sm">Add</Button>}
        density="compact"
      />,
    )

    expect(markup).toContain('class="section-header"')
    expect(markup).toContain('data-density="compact"')
    expect(markup).toContain('section-header-description')
    expect(markup).toContain('section-header-meta')
    expect(markup).toContain('section-header-actions')
    expect(markup).toContain('<h3>Subtasks</h3>')
  })

  it('covers the navigation, layer, and feedback component contracts', () => {
    const markup = renderToStaticMarkup(
      <div>
        <Toolbar label="Page actions"><Button>New</Button></Toolbar>
        <ToggleGroup aria-label="Density" value="comfortable" options={[{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }]} />
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Settings', current: true }]} />
        <BackLink href="/">Back to home</BackLink>
        <Popover open trigger={<button type="button">More</button>}><span>Popover content</span></Popover>
        <Menu open trigger={<button type="button">Actions</button>}><MenuItem>Rename</MenuItem></Menu>
        <Dialog open title="Confirm change" description="Review the setting."><p>Body</p></Dialog>
        <Sheet open side="start" title="Details"><p>Panel</p></Sheet>
        <Alert variant="error" onDismiss={() => undefined}>Something failed.</Alert>
        <Toast variant="success" durationMs={0} onDismiss={() => undefined}>Saved.</Toast>
        <Progress value={40} showValue label="Completion" />
        <Skeleton variant="block" />
      </div>,
    )

    expect(markup).toContain('role="toolbar"')
    expect(markup).toContain('role="radiogroup"')
    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain('href="/"')
    expect(markup).toContain('role="region"')
    expect(markup).toContain('role="menu"')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('class="sheet sheet-start"')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('class="toast toast-success"')
    expect(markup).toContain('aria-valuenow="40"')
    expect(markup).toContain('aria-hidden="true"')
  })
})
