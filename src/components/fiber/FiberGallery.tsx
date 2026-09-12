import { useState } from 'react'
import { Check, CircleDot, FlaskConical, Plus, Sparkles, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import {
  Button,
  ButtonLink,
  Chip,
  EmptyState,
  Field,
  IconButton,
  Input,
  MenuItem,
  Spinner,
  ToggleButton,
  type ButtonVariant,
} from 'fiber'

const BUTTON_VARIANTS: ButtonVariant[] = ['solid', 'accent', 'outline', 'ghost', 'danger']
const CHIP_ACCENTS = ['thread', 'task', 'idea', 'question', 'decision', 'danger', 'neutral'] as const

const COMPONENTS = [
  { id: 'button', label: 'Button', group: 'Actions', description: 'The shared action primitive for commands, forms, and primary moments.' },
  { id: 'field', label: 'Field', group: 'Forms', description: 'A labeled control shell that wires hints, errors, and required state together.' },
  { id: 'input', label: 'Input', group: 'Forms', description: 'A 44px text control that inherits Fiber focus, disabled, and validation behavior.' },
  { id: 'button-link', label: 'ButtonLink', group: 'Navigation', description: 'Router-aware navigation that carries the same visual language as a button.' },
  { id: 'icon-button', label: 'IconButton', group: 'Compact action', description: 'An icon-only action with a consistent hit target and an explicit accessible label.' },
  { id: 'toggle-button', label: 'ToggleButton', group: 'Stateful action', description: 'A pressed-state button for view modes, filters, and persistent choices.' },
  { id: 'menu-item', label: 'MenuItem', group: 'Menus', description: 'A menu action with shared sizing, focus treatment, and disabled behavior.' },
  { id: 'chip', label: 'Chip', group: 'Labels and filters', description: 'A semantic label for tags, statuses, and lightweight filtering.' },
  { id: 'spinner', label: 'Spinner', group: 'Feedback', description: 'An announced loading indicator that works inline or in a quiet status surface.' },
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
                <Field label="Read-only workspace" hint="This field is unavailable in the current mode." controlId="fiber-read-only">
                  <Input defaultValue="Personal" disabled />
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
                <MenuItem onClick={() => setMenuChoice('Open thread')} className={menuChoice === 'Open thread' ? 'active' : undefined}><span>Open thread</span>{menuChoice === 'Open thread' && <Check size={13} />}</MenuItem>
                <MenuItem onClick={() => setMenuChoice('Duplicate')} className={menuChoice === 'Duplicate' ? 'active' : undefined}><span>Duplicate</span>{menuChoice === 'Duplicate' && <Check size={13} />}</MenuItem>
                <MenuItem disabled><span>Archive</span><small>Unavailable</small></MenuItem>
              </div>
              <span className="fiber-state-note">Selected: {menuChoice}</span>
            </div>
            <p className="fiber-detail-note">MenuItem composes the shared button behavior with the 44px menu hit area and active/disabled states.</p>
          </div>
        )
      case 'chip':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Semantic accents</span>
              <div className="fiber-chip-row">{CHIP_ACCENTS.map((accent) => <Chip key={accent} accent={accent}>{accent}</Chip>)}</div>
            </div>
            <div className="fiber-demo-block">
              <span className="fiber-demo-label">Interactive chip</span>
              <div className="fiber-chip-row">
                {chipRemoved ? <Button variant="ghost" size="sm" onClick={() => setChipRemoved(false)}>Restore removable chip</Button> : <Chip interactive accent="thread" icon={<Sparkles size={12} />} onRemove={() => setChipRemoved(true)}>Removable</Chip>}
              </div>
            </div>
            <p className="fiber-detail-note">Accent tokens make labels scannable without creating one-off badge styles for each feature.</p>
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
      case 'empty-state':
        return (
          <div className="fiber-detail-content">
            <div className="fiber-demo-block fiber-empty-demo">
              <EmptyState icon={<FlaskConical size={24} />} title="Nothing here yet" hint="Add a first item to give this view a little signal." />
            </div>
            <p className="fiber-detail-note">EmptyState turns a blank surface into a clear next step with optional iconography and guidance.</p>
          </div>
        )
    }
  }

  return (
    <section className="settings-category fiber-gallery" hidden={hidden} aria-labelledby="settings-category-fiber">
      <header className="settings-category-header fiber-gallery-header">
        <div className="fiber-gallery-mark"><FlaskConical size={20} /></div>
        <div>
          <h2 id="settings-category-fiber">Fiber UI library</h2>
          <p>A living catalog of Thread’s shared components, states, and interaction patterns.</p>
        </div>
      </header>

      <section className="fiber-hero">
        <div>
          <span className="fiber-kicker">The Thread interface layer</span>
          <h3>Small pieces. One clear language.</h3>
          <p>Fiber keeps actions, feedback, and controls recognizable wherever work happens.</p>
        </div>
        <div className="fiber-hero-actions">
          <Button variant="accent" onClick={() => selectComponent('button')}><Sparkles size={15} /> Start with Button</Button>
          <ButtonLink variant="ghost" to="?component=button-link">Inspect ButtonLink</ButtonLink>
        </div>
      </section>

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
          <p className="fiber-component-nav-note">Select a primitive to inspect its states and intended use.</p>
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
