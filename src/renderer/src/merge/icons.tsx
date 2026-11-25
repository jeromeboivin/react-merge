import type { Role } from './roles'

export type { Role }

const COLOR: Record<Role, string> = {
  base: 'var(--m-base)',
  left: 'var(--m-left)',
  right: 'var(--m-right)',
  merge: 'var(--color-text-secondary)'
}

/**
 * The marks used for each file throughout the UI: base = square, left = triangle,
 * right = circle, merge = diamond.
 */
export function RoleIcon({
  role,
  size = 14,
  filled = true,
  muted = false
}: {
  role: Role
  size?: number
  filled?: boolean
  muted?: boolean
}): React.JSX.Element {
  const c = muted ? 'var(--color-text-muted)' : COLOR[role]
  const fill = filled ? c : 'none'
  const sw = 1.6
  let shape: React.JSX.Element
  switch (role) {
    case 'base':
      shape = (
        <rect
          x="2.5"
          y="2.5"
          width="11"
          height="11"
          rx="2"
          fill={fill}
          stroke={c}
          strokeWidth={sw}
        />
      )
      break
    case 'left':
      shape = (
        <path
          d="M8 2.2 L14 13.2 L2 13.2 Z"
          fill={fill}
          stroke={c}
          strokeWidth={sw}
          strokeLinejoin="round"
        />
      )
      break
    case 'right':
      shape = <circle cx="8" cy="8" r="5.8" fill={fill} stroke={c} strokeWidth={sw} />
      break
    case 'merge':
      shape = (
        <path
          d="M8 1.8 L14.2 8 L8 14.2 L1.8 8 Z"
          fill={fill}
          stroke={c}
          strokeWidth={sw}
          strokeLinejoin="round"
        />
      )
      break
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="shrink-0">
      {shape}
    </svg>
  )
}
