export const themes = [
  {
    id: 'github-light',
    name: 'GitHub Light',
    mode: 'Light',
    swatches: ['#ffffff', '#f6f8fa', '#0969da', '#1f2328'],
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    mode: 'Light',
    swatches: ['#fdf6e3', '#eee8d5', '#2074af', '#073642'],
  },
  {
    id: 'dracula',
    name: 'Dracula',
    mode: 'Dark',
    swatches: ['#282a36', '#44475a', '#bd93f9', '#f8f8f2'],
  },
  {
    id: 'nord',
    name: 'Nord',
    mode: 'Dark',
    swatches: ['#2e3440', '#4c566a', '#88c0d0', '#eceff4'],
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    mode: 'Dark',
    swatches: ['#1e1e2e', '#45475a', '#89b4fa', '#cdd6f4'],
  },
] as const

export type ThemeId = (typeof themes)[number]['id']

const DARK_THEME_IDS: ReadonlySet<string> = new Set(['dracula', 'nord', 'catppuccin-mocha'])

export function isDarkTheme(id: string): boolean {
  return DARK_THEME_IDS.has(id)
}

const STORAGE_KEY = 'thread.theme'
const DEFAULT_THEME: ThemeId = 'github-light'

export function isThemeId(value: string | null): value is ThemeId {
  return themes.some((theme) => theme.id === value)
}

export function getTheme(): ThemeId {
  if (typeof window === 'undefined') return DEFAULT_THEME
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return isThemeId(stored) ? stored : DEFAULT_THEME
}

export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = themes.find((item) => item.id === theme)?.mode.toLowerCase() ?? 'light'
  window.localStorage.setItem(STORAGE_KEY, theme)
}

export function initializeTheme() {
  applyTheme(getTheme())
}
