import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { LaunchOptions } from '../shared/args'
import type { Command, HostApi, LoadedFile, MenuState, Preferences, Session } from '../shared/ipc'

const api: HostApi = {
  getSession: () => ipcRenderer.invoke('session:get') as Promise<Session>,
  loadFile: (path, charset) =>
    ipcRenderer.invoke('file:load', path, charset) as Promise<LoadedFile>,
  saveFile: (path, text, charset) =>
    ipcRenderer.invoke('file:save', path, text, charset) as Promise<void>,
  fileExists: (path) => ipcRenderer.invoke('file:exists', path) as Promise<boolean>,
  showOpenDialog: (title, defaultPath) =>
    ipcRenderer.invoke('dialog:open', title, defaultPath) as Promise<string | null>,
  showSaveDialog: (title, defaultPath) =>
    ipcRenderer.invoke('dialog:save', title, defaultPath) as Promise<string | null>,
  setPrefs: (prefs) => ipcRenderer.invoke('prefs:set', prefs) as Promise<Preferences>,
  setTitle: (title) => {
    // Electron mirrors the page title to the window title.
    document.title = title
  },
  setMenuState: (state: MenuState) => {
    ipcRenderer.send('menu:state', state)
  },
  onCommand: (cb) => {
    const listener = (_e: IpcRendererEvent, cmd: Command): void => {
      cb(cmd)
    }
    ipcRenderer.on('command', listener)
    return () => ipcRenderer.removeListener('command', listener)
  },
  onCloseRequest: (cb) => {
    const listener = (): void => {
      cb()
    }
    ipcRenderer.on('close-request', listener)
    return () => ipcRenderer.removeListener('close-request', listener)
  },
  closeWindow: () => {
    ipcRenderer.send('window:close')
  },
  openWindow: (options: LaunchOptions) => {
    ipcRenderer.send('window:open', options)
  },
  quit: () => {
    ipcRenderer.send('app:quit')
  }
}

contextBridge.exposeInMainWorld('api', api)
