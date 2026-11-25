import type { LaunchOptions } from './args'
import type { ComparisonMethod } from './merge/compare'
import type { LineEndingStyle } from './merge/text'

export interface LoadedFile {
  path: string
  size: number
  text: string
  /** The charset actually used (a byte-order mark may override the requested one). */
  charset: string
  binary: boolean
  /** The bytes are not valid in the charset used. */
  suspect: boolean
}

export type ThemeId = 'system' | 'light' | 'dark'

export const THEME_IDS: readonly ThemeId[] = ['system', 'light', 'dark']

export interface Preferences {
  theme: ThemeId
  fontFamily: string
  fontSize: number
  tabWidth: number
  insertSpaces: boolean
  /** Default character encoding of files. */
  charset: string
  /** Default line ending of the merge file. */
  lineEnding: LineEndingStyle
  comparison: ComparisonMethod
  showLineNumbers: boolean
  inlineDiffs: boolean
  syntaxHighlighting: boolean
  showWhitespace: boolean
  showToolbar: boolean
  singlePane: boolean
  showBase: boolean
  /** Top panes' share of the height in a 3-way merge. */
  mergeSplit: number
}

export const DEFAULT_FONT_FAMILY =
  "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'DejaVu Sans Mono', ui-monospace, Menlo, Consolas, monospace"

export function defaultPreferences(platform: string): Preferences {
  return {
    theme: 'system',
    fontFamily: DEFAULT_FONT_FAMILY,
    fontSize: 13,
    tabWidth: 8,
    insertSpaces: false,
    charset: 'none',
    lineEnding: platform === 'win32' ? 'win' : 'unix',
    comparison: 'lineEndings',
    showLineNumbers: true,
    inlineDiffs: true,
    syntaxHighlighting: true,
    showWhitespace: false,
    showToolbar: true,
    singlePane: false,
    showBase: true,
    mergeSplit: 0.55
  }
}

export interface Session {
  options: LaunchOptions
  prefs: Preferences
  platform: string
  version: string
}

/** Commands sent by the native menu to the window. */
export type CommandId =
  | 'new'
  | 'save'
  | 'saveAs'
  | 'close'
  | 'preferences'
  | 'about'
  | 'help'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'useSelectionForFind'
  | 'editLeft'
  | 'editRight'
  | 'font'
  | 'tabOptions'
  | 'charset'
  | 'lineEnding'
  | 'comparison'
  | 'toggleToolbar'
  | 'doublePane'
  | 'singlePane'
  | 'toggleBase'
  | 'toggleInline'
  | 'toggleLineNumbers'
  | 'toggleSyntax'
  | 'toggleWhitespace'
  | 'prevDiff'
  | 'nextDiff'
  | 'prevConflict'
  | 'nextConflict'
  | 'find'
  | 'goto'
  | 'refresh'

export interface Command {
  id: CommandId
  /** Charset id, line ending style or comparison method for the parametric commands. */
  arg?: string
}

/** What the window reports so the native menu can show checks and disabled items. */
export interface MenuState {
  mode: 'none' | 'diff' | 'merge'
  canSave: boolean
  canUndo: boolean
  canRedo: boolean
  editLeft: boolean
  editRight: boolean
  charset: string
  lineEnding: string
  comparison: string
  showToolbar: boolean
  singlePane: boolean
  showBase: boolean
  inlineDiffs: boolean
  showLineNumbers: boolean
  syntaxHighlighting: boolean
  showWhitespace: boolean
  hasPrevDiff: boolean
  hasNextDiff: boolean
  hasPrevConflict: boolean
  hasNextConflict: boolean
}

export interface MessageBoxOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning'
  title?: string
  message: string
  detail?: string
  buttons: string[]
  defaultId?: number
  cancelId?: number
}

/** The API the preload script exposes as `window.api`. */
export interface HostApi {
  getSession(): Promise<Session>
  loadFile(path: string, charset: string): Promise<LoadedFile>
  saveFile(path: string, text: string, charset: string): Promise<void>
  fileExists(path: string): Promise<boolean>
  showOpenDialog(title: string, defaultPath?: string): Promise<string | null>
  showSaveDialog(title: string, defaultPath?: string): Promise<string | null>
  setPrefs(prefs: Partial<Preferences>): Promise<Preferences>
  setTitle(title: string): void
  setMenuState(state: MenuState): void
  onCommand(cb: (cmd: Command) => void): () => void
  onCloseRequest(cb: () => void): () => void
  /** Close this window for good (after the user confirmed). */
  closeWindow(): void
  openWindow(options: LaunchOptions): void
  quit(): void
}
