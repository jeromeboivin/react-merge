import type { HostApi } from '../../../shared/ipc'

/**
 * Everything the merge UI needs from its environment. The standalone app passes the Electron
 * preload API; a host app can pass its own implementation of the same contract.
 */
export type MergeHost = HostApi
