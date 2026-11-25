import type { Source } from '../../../shared/merge/diff'

/** The four files of a merge, as named in the UI. */
export type Role = Source | 'merge'

export const ROLE_NAME: Record<Role, string> = {
  base: 'Base',
  left: 'Left',
  right: 'Right',
  merge: 'Merge'
}
