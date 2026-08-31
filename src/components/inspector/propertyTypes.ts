import type { PropertyType } from '../../db'

// The property types offered when creating a new definition. A definition's
// type is fixed at creation (there is no edit path), so this list is the only
// place a user picks it.
export const PROPERTY_TYPES: Array<{ value: PropertyType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'rich_text', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
  { value: 'url', label: 'URL' },
]
