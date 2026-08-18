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
    swatches: ['#fdf6e3', '#eee8d5', '#268bd2', '#073642'],
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
] as const

export type ThemeId = (typeof themes)[number]['id']

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
