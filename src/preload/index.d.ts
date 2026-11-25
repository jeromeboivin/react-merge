import type { HostApi } from '../shared/ipc'

declare global {
  interface Window {
    api: HostApi
  }
}
