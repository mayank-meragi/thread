import { createElement } from 'react'
import * as Icons from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export function iconFor(name: string): LucideIcon {
  const icons = Icons as unknown as Record<string, LucideIcon>
  return icons[name] ?? Icons.Bot
}

// Uses createElement rather than JSX (`<Icon />`) because the icon component
// is only known by name at runtime -- writing it as a JSX tag would bind a
// fresh component reference on every render, which loses state and trips
// react-hooks/static-components.
export function DynamicIcon({ name, size }: { name: string; size?: number }) {
  return createElement(iconFor(name), { size })
}

// A curated subset of lucide-react icon names, not the whole library, so the
// picker grid stays a browsable size and the AI persona builder has a fixed
// enum to choose from instead of guessing at export names that don't exist.
export const PERSONA_ICON_NAMES = [
  'Bot', 'Sparkles', 'Brain', 'MessageCircle', 'User', 'Users', 'Smile',
  'Briefcase', 'GraduationCap', 'Scale', 'Landmark', 'Wallet', 'PiggyBank', 'ShoppingCart',
  'Heart', 'Stethoscope', 'Dumbbell', 'Leaf', 'Flower2', 'TreePine',
  'BookOpen', 'Pencil', 'FileText', 'Newspaper', 'Mic', 'PenTool',
  'Code', 'Wrench', 'Hammer', 'Lightbulb', 'Rocket', 'Target', 'Compass',
  'Palette', 'Camera', 'Film', 'Music', 'Gamepad2', 'Puzzle',
  'Coffee', 'Utensils', 'Sun', 'Moon', 'Star', 'Cloud', 'Mountain',
  'Plane', 'Globe', 'MapPin', 'Home', 'Building2', 'Car', 'Bike',
  'Clock', 'Calendar', 'NotebookPen', 'ClipboardList', 'Folder', 'Mail', 'Phone',
  'Shield', 'Key', 'Gift', 'Trophy', 'Crown', 'Gem', 'Flag', 'Award', 'Anchor',
] as const

export type PersonaIconName = (typeof PERSONA_ICON_NAMES)[number]
