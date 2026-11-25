import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, type IpcMainEvent } from 'electron'
import { existsSync, statSync } from 'fs'
import { join, resolve } from 'path'
import appIcon from '../../resources/icons/linux/256x256.png?asset'
import { APP_NAME, errorReport, parseArgs, usage, type LaunchOptions } from '../shared/args'
import type { Command, MenuState, Preferences, Session } from '../shared/ipc'
import { loadFile, saveFile } from './fileio'
import { buildMenu, EMPTY_MENU_STATE } from './menu'
import { loadPrefs, savePrefs } from './prefs'

interface WindowInfo {
  options: LaunchOptions
  menuState: MenuState
  allowClose: boolean
}

const windows = new Map<number, WindowInfo>()

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** Command-line arguments meant for the app, without Electron's and Chromium's own. */
function appArgs(): string[] {
  const args = process.argv
    .slice(1)
    .filter((a) => !(a.startsWith('--') && a !== '--help' && a !== '--version'))
  // Unpackaged (`electron <app dir> ...`), the first remaining argument is the app itself.
  if (!app.isPackaged) args.shift()
  return args
}

function absolutize(o: LaunchOptions): LaunchOptions {
  const abs = (p?: string): string | undefined => (p === undefined ? undefined : resolve(p))
  return { ...o, base: abs(o.base), left: abs(o.left), right: abs(o.right), merge: abs(o.merge) }
}

function createWindow(options: LaunchOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 640,
    minHeight: 420,
    show: false,
    title: APP_NAME,
    icon: appIcon,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b1016' : '#f4f5f7',
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      spellcheck: false
    }
  })
  const info: WindowInfo = { options, menuState: EMPTY_MENU_STATE, allowClose: false }
  windows.set(win.webContents.id, info)
  const id = win.webContents.id
  if (process.platform !== 'darwin') win.setMenu(buildMenu(win, info.menuState))

  win.on('ready-to-show', () => {
    win.show()
  })
  win.on('focus', () => {
    if (process.platform === 'darwin' && !info.allowClose)
      Menu.setApplicationMenu(buildMenu(win, info.menuState))
  })
  win.on('close', (e) => {
    if (info.allowClose) return
    e.preventDefault()
    if (!win.webContents.isDestroyed()) win.webContents.send('close-request')
  })
  win.on('closed', () => {
    windows.delete(id)
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

/** The live window that sent an IPC message, or null once it is closing/destroyed. */
function senderWindow(e: IpcMainEvent | Electron.IpcMainInvokeEvent): BrowserWindow | null {
  if (e.sender.isDestroyed()) return null
  const win = BrowserWindow.fromWebContents(e.sender)
  return win && !win.isDestroyed() ? win : null
}

function registerIpc(): void {
  ipcMain.handle('session:get', async (e): Promise<Session> => {
    const info = e.sender.isDestroyed() ? undefined : windows.get(e.sender.id)
    return {
      options: info?.options ?? { labels: {} },
      prefs: await loadPrefs(),
      platform: process.platform,
      version: app.getVersion()
    }
  })
  ipcMain.handle('file:load', (_e, path: string, charset: string) => loadFile(path, charset))
  ipcMain.handle('file:save', (_e, path: string, text: string, charset: string) =>
    saveFile(path, text, charset)
  )
  ipcMain.handle('file:exists', (_e, path: string) => isFile(path))
  ipcMain.handle('dialog:open', async (e, title: string, defaultPath?: string) => {
    const win = senderWindow(e)
    const opts: Electron.OpenDialogOptions = { title, defaultPath, properties: ['openFile'] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  ipcMain.handle('dialog:save', async (e, title: string, defaultPath?: string) => {
    const win = senderWindow(e)
    const opts: Electron.SaveDialogOptions = { title, defaultPath }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    return r.canceled || !r.filePath ? null : r.filePath
  })
  ipcMain.handle('prefs:set', (_e, patch: Partial<Preferences>) => savePrefs(patch))
  ipcMain.on('menu:state', (e, state: MenuState) => {
    const win = senderWindow(e)
    const info = win ? windows.get(win.webContents.id) : undefined
    if (!win || !info || info.allowClose) return
    info.menuState = state
    try {
      const menu = buildMenu(win, state)
      if (process.platform === 'darwin') {
        if (win.isFocused()) Menu.setApplicationMenu(menu)
      } else win.setMenu(menu)
    } catch {
      // The window is being torn down; its menu no longer matters.
    }
  })
  ipcMain.on('window:close', (e) => {
    const win = senderWindow(e)
    const info = win ? windows.get(win.webContents.id) : undefined
    if (!win || !info) return
    info.allowClose = true
    win.close()
  })
  ipcMain.on('window:open', (_e, options: LaunchOptions) => {
    createWindow(absolutize(options))
  })
  ipcMain.on('app:quit', () => {
    // Ask each window in turn; a window that agrees closes itself.
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue
      const cmd: Command = { id: 'close' }
      w.webContents.send('command', cmd)
    }
  })
}

function main(): void {
  const parsed = parseArgs(appArgs(), (p) => existsSync(p) && isFile(p))
  if (parsed.kind === 'help') {
    process.stdout.write(usage())
    app.exit(0)
    return
  }
  if (parsed.kind === 'version') {
    process.stdout.write(
      `${APP_NAME}\nVersion ${app.getVersion()} (Electron ${process.versions.electron})\n`
    )
    app.exit(0)
    return
  }
  if (parsed.kind === 'error') {
    // Argument errors are reported but the exit status stays 0, which merge tool callers expect.
    process.stderr.write(errorReport(parsed.errors))
    app.exit(0)
    return
  }
  app.setName(APP_NAME)
  // Tests run with a throw-away profile.
  if (process.env.REACT_MERGE_USER_DATA) app.setPath('userData', process.env.REACT_MERGE_USER_DATA)
  void app.whenReady().then(() => {
    registerIpc()
    createWindow(absolutize(parsed.options))
  })
  app.on('window-all-closed', () => {
    app.quit()
  })
}

main()
