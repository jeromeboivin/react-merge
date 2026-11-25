// The light and dark themes, applied as CSS custom properties on :root. When the merge view is
// embedded in a host app, the host's own theming takes over.

import type { ThemeId } from '../../shared/ipc'

type Tokens = Record<string, string>

const lightTheme: Tokens = {
  '--color-brand': '#4930C1',
  '--color-brand-light': '#5437DF',
  '--color-brand-soft': '#eeeafc',
  '--color-brand-faint': '#f5f3fe',
  '--color-surface': '#f4f5f7',
  '--color-surface-light': '#eaecf0',
  '--color-surface-lighter': '#d9dce3',
  '--color-surface-white': '#ffffff',
  '--color-surface-warm': '#f9fafb',
  '--color-text': '#0f1115',
  '--color-title': 'rgb(61, 61, 61)',
  '--color-subtitle': '#4b5563',
  '--color-text-secondary': '#4b5563',
  '--color-text-muted': '#9ca3af',
  '--color-border': '#d1d5db',
  '--color-border-light': '#e5e7eb',
  '--color-success': '#16a34a',
  '--color-error': '#EF0A39',
  '--color-warning': '#FFB600',
  '--color-input-bg': '#ffffff',
  '--color-input-border': '#d1d5db',
  '--color-input-focus': '#4930C1',
  '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.05)',
  '--shadow-md': '0 2px 8px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05)',
  '--shadow-lg': '0 4px 16px rgba(0, 0, 0, 0.10), 0 2px 6px rgba(0, 0, 0, 0.05)'
}

const darkTheme: Tokens = {
  '--color-brand': '#5437DF',
  '--color-brand-light': '#6b52f0',
  '--color-brand-soft': '#221b42',
  '--color-brand-faint': '#18152d',
  '--color-surface': '#0b1016',
  '--color-surface-light': '#131a22',
  '--color-surface-lighter': '#1a2430',
  '--color-surface-white': '#202c39',
  '--color-surface-warm': '#10161d',
  '--color-text': '#EDEFF1',
  '--color-title': 'rgb(103, 180, 255)',
  '--color-subtitle': 'rgb(237, 243, 250)',
  '--color-text-secondary': '#C5CDD4',
  '--color-text-muted': '#8793A1',
  '--color-border': '#314458',
  '--color-border-light': '#27384A',
  '--color-success': '#3fb950',
  '--color-error': '#F43160',
  '--color-warning': '#FFD400',
  '--color-input-bg': '#131a22',
  '--color-input-border': '#314458',
  '--color-input-focus': '#5437DF',
  '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.3)',
  '--shadow-md': '0 2px 8px rgba(0, 0, 0, 0.4), 0 1px 3px rgba(0, 0, 0, 0.3)',
  '--shadow-lg': '0 4px 16px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.3)'
}

const syntaxLight: Record<string, string> = {
  comment: '#6b7280',
  punctuation: '#6b7280',
  property: '#4930C1',
  boolean: '#b45309',
  string: '#15803d',
  operator: '#6b7280',
  keyword: '#0e7c90',
  function: '#4930C1',
  variable: '#5437DF'
}

const syntaxDark: Record<string, string> = {
  comment: '#6b7685',
  punctuation: '#8b949e',
  property: '#79c0ff',
  boolean: '#FFD400',
  string: '#3fb950',
  operator: '#8b949e',
  keyword: '#24B7CF',
  function: '#d2a8ff',
  variable: '#a99cff'
}

const SYNTAX_SELECTORS: Record<string, string> = {
  comment: '.token.comment, .token.prolog, .token.doctype, .token.cdata',
  punctuation: '.token.punctuation',
  property: '.token.property, .token.tag, .token.constant, .token.symbol, .token.deleted',
  boolean: '.token.boolean, .token.number',
  string:
    '.token.selector, .token.attr-name, .token.string, .token.char, .token.builtin, .token.inserted',
  operator: '.token.operator, .token.entity, .token.url',
  keyword: '.token.atrule, .token.attr-value, .token.keyword',
  function: '.token.function, .token.class-name',
  variable: '.token.regex, .token.important, .token.variable'
}

let media: MediaQueryList | null = null
let mediaListener: (() => void) | null = null

export function resolveDark(theme: ThemeId): boolean {
  if (theme === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches
  return theme === 'dark'
}

export function applyTheme(theme: ThemeId): void {
  if (media && mediaListener) media.removeEventListener('change', mediaListener)
  media = null
  mediaListener = null
  if (theme === 'system') {
    media = window.matchMedia('(prefers-color-scheme: dark)')
    mediaListener = () => {
      applyTheme('system')
    }
    media.addEventListener('change', mediaListener)
  }
  const dark = resolveDark(theme)
  const root = document.documentElement
  for (const [k, v] of Object.entries(dark ? darkTheme : lightTheme)) root.style.setProperty(k, v)
  root.dataset.scheme = dark ? 'dark' : 'light'
  root.style.colorScheme = dark ? 'dark' : 'light'

  let style = document.getElementById('m-syntax') as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = 'm-syntax'
    document.head.appendChild(style)
  }
  style.textContent = Object.entries(dark ? syntaxDark : syntaxLight)
    .map(([k, c]) => `${SYNTAX_SELECTORS[k]} { color: ${c}; }`)
    .join('\n')
}
