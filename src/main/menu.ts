import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { APP_NAME } from '../shared/args'
import { CHARSET_GROUPS, CHARSETS } from '../shared/charsets'
import type { Command, CommandId, MenuState } from '../shared/ipc'
import { COMPARISON_LABELS, COMPARISON_METHODS } from '../shared/merge/compare'
import { LINE_ENDING_LABELS } from '../shared/merge/text'

export const EMPTY_MENU_STATE: MenuState = {
  mode: 'none',
  canSave: false,
  canUndo: false,
  canRedo: false,
  editLeft: false,
  editRight: false,
  charset: 'none',
  lineEnding: 'unix',
  comparison: 'lineEndings',
  showToolbar: true,
  singlePane: false,
  showBase: true,
  inlineDiffs: true,
  showLineNumbers: true,
  syntaxHighlighting: true,
  showWhitespace: false,
  hasPrevDiff: false,
  hasNextDiff: false,
  hasPrevConflict: false,
  hasNextConflict: false
}

/**
 * The window's native menu (File, Edit, View, Search, Help). Shortcuts are only displayed here
 * (registerAccelerator: false): the React view handles the keys itself, so it works the same
 * when embedded in another app without this menu.
 */
export function buildMenu(win: BrowserWindow, s: MenuState): Menu {
  const send = (id: CommandId, arg?: string): void => {
    const cmd: Command = arg === undefined ? { id } : { id, arg }
    if (!win.isDestroyed()) win.webContents.send('command', cmd)
  }
  const item = (
    label: string,
    id: CommandId,
    opts: Partial<MenuItemConstructorOptions> = {}
  ): MenuItemConstructorOptions => ({
    label,
    registerAccelerator: false,
    click: () => {
      send(id)
    },
    ...opts
  })
  const check = (
    label: string,
    id: CommandId,
    checked: boolean,
    opts: Partial<MenuItemConstructorOptions> = {}
  ): MenuItemConstructorOptions => item(label, id, { type: 'checkbox', checked, ...opts })
  const open = s.mode !== 'none'
  const sep: MenuItemConstructorOptions = { type: 'separator' }

  const charsetMenu: MenuItemConstructorOptions[] = []
  for (const group of CHARSET_GROUPS) {
    if (charsetMenu.length > 0) charsetMenu.push(sep)
    for (const c of CHARSETS.filter((x) => x.group === group)) {
      charsetMenu.push({
        label: c.label,
        type: 'radio',
        checked: s.charset === c.id,
        click: () => {
          send('charset', c.id)
        }
      })
    }
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        item('&New Merge or Diff...', 'new', { accelerator: 'CmdOrCtrl+N' }),
        sep,
        item('&Save', 'save', { accelerator: 'CmdOrCtrl+S', enabled: s.canSave }),
        item('Save &As...', 'saveAs', {
          enabled: open && (s.mode === 'merge' || s.editLeft || s.editRight)
        }),
        sep,
        item('&Close', 'close', { accelerator: 'CmdOrCtrl+W' }),
        sep,
        item('Pre&ferences...', 'preferences'),
        sep,
        {
          label: 'E&xit',
          accelerator: 'CmdOrCtrl+Q',
          registerAccelerator: false,
          click: () => {
            send('close', 'quitAll')
          }
        }
      ]
    },
    {
      label: '&Edit',
      submenu: [
        item('&Undo', 'undo', { accelerator: 'CmdOrCtrl+Z', enabled: s.canUndo }),
        item('&Redo', 'redo', { accelerator: 'CmdOrCtrl+Y', enabled: s.canRedo }),
        sep,
        item('Cu&t', 'cut', { accelerator: 'CmdOrCtrl+X', enabled: open }),
        item('&Copy', 'copy', { accelerator: 'CmdOrCtrl+C', enabled: open }),
        item('&Paste', 'paste', { accelerator: 'CmdOrCtrl+V', enabled: open }),
        item('Select &All', 'selectAll', { accelerator: 'CmdOrCtrl+A', enabled: open }),
        item('Us&e Selection for Find', 'useSelectionForFind', {
          accelerator: 'CmdOrCtrl+E',
          enabled: open
        }),
        sep,
        check('&Edit Left Pane', 'editLeft', s.editLeft, {
          visible: s.mode === 'diff',
          enabled: !s.singlePane
        }),
        check('E&dit Right Pane', 'editRight', s.editRight, {
          visible: s.mode === 'diff',
          enabled: !s.singlePane
        }),
        { type: 'separator', visible: s.mode === 'diff' },
        { label: 'Character &Encoding', submenu: charsetMenu, enabled: open },
        {
          label: '&Line Endings',
          visible: s.mode === 'merge',
          submenu: (['unix', 'win', 'mac'] as const).map((le) => ({
            label: LINE_ENDING_LABELS[le],
            type: 'radio' as const,
            checked: s.lineEnding === le,
            click: () => {
              send('lineEnding', le)
            }
          }))
        },
        {
          label: 'Comparison &Method',
          enabled: open,
          submenu: COMPARISON_METHODS.map((m) => ({
            label: COMPARISON_LABELS[m],
            type: 'radio' as const,
            checked: s.comparison === m,
            click: () => {
              send('comparison', m)
            }
          }))
        },
        sep,
        item('&Font...', 'font'),
        item('T&ab and Space Options...', 'tabOptions')
      ]
    },
    {
      label: '&View',
      submenu: [
        check('&Toolbar', 'toggleToolbar', s.showToolbar),
        sep,
        {
          label: '&Double Pane Diff Layout',
          type: 'radio',
          checked: !s.singlePane,
          visible: s.mode === 'diff',
          click: () => {
            send('doublePane')
          }
        },
        {
          label: '&Single Pane Diff Layout',
          type: 'radio',
          checked: s.singlePane,
          visible: s.mode === 'diff',
          click: () => {
            send('singlePane')
          }
        },
        check('&Base File', 'toggleBase', s.showBase, { visible: s.mode === 'merge' }),
        sep,
        check('&Inline Differences', 'toggleInline', s.inlineDiffs, { accelerator: 'CmdOrCtrl+I' }),
        check('&Line Numbers', 'toggleLineNumbers', s.showLineNumbers, {
          accelerator: 'CmdOrCtrl+L'
        }),
        check('&Syntax Highlighting', 'toggleSyntax', s.syntaxHighlighting, {
          accelerator: 'CmdOrCtrl+Shift+H'
        }),
        check('&Tabs and Spaces', 'toggleWhitespace', s.showWhitespace),
        sep,
        item('&Refresh All', 'refresh', { accelerator: 'F5', enabled: open })
      ]
    },
    {
      label: '&Search',
      submenu: [
        item('&Find...', 'find', { accelerator: 'CmdOrCtrl+F', enabled: open }),
        item('&Go To Line Number...', 'goto', { accelerator: 'CmdOrCtrl+G', enabled: open }),
        sep,
        item('&Previous Diff', 'prevDiff', { accelerator: 'CmdOrCtrl+1', enabled: s.hasPrevDiff }),
        item('&Next Diff', 'nextDiff', { accelerator: 'CmdOrCtrl+2', enabled: s.hasNextDiff }),
        item('P&revious Conflict', 'prevConflict', {
          accelerator: 'CmdOrCtrl+3',
          enabled: s.hasPrevConflict,
          visible: s.mode === 'merge'
        }),
        item('Ne&xt Conflict', 'nextConflict', {
          accelerator: 'CmdOrCtrl+4',
          enabled: s.hasNextConflict,
          visible: s.mode === 'merge'
        })
      ]
    },
    {
      label: '&Help',
      submenu: [
        item(`${APP_NAME} &Help`, 'help', { accelerator: 'F1' }),
        item(`&About ${APP_NAME}`, 'about')
      ]
    }
  ]
  return Menu.buildFromTemplate(template)
}
