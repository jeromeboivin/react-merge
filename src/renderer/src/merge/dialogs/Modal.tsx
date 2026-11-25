import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  title: string
  children: ReactNode
  footer?: ReactNode
  width?: number
  onClose: () => void
  /** Pressing Enter (outside a textarea/button) triggers this. */
  onEnter?: () => void
  /** Non-blocking: no scrim, the app stays usable (Find). */
  floating?: boolean
}

export function Modal({
  title,
  children,
  footer,
  width = 460,
  onClose,
  onEnter,
  floating
}: ModalProps): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const first = el.querySelector<HTMLElement>(
      '[data-autofocus], input, select, button:not([data-close])'
    )
    first?.focus()
    if (first instanceof HTMLInputElement) first.select()
  }, [])
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Enter' && onEnter) {
      const t = e.target as HTMLElement
      if (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON') return
      e.preventDefault()
      onEnter()
    }
  }
  const card = (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal={!floating}
      aria-label={title}
      className="flex max-h-[90vh] flex-col rounded-[var(--radius-menu)] border border-border bg-surface-white text-text"
      style={{ width, boxShadow: 'var(--shadow-lg)' }}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        e.stopPropagation()
      }}
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h2 className="text-ui font-semibold text-title">{title}</h2>
        <button
          type="button"
          data-close
          aria-label="Close"
          className="rounded-[var(--radius-control)] p-1 text-text-muted hover:bg-surface-light hover:text-text"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-3 text-ui select-text">{children}</div>
      {footer && (
        <div className="flex justify-end gap-2 border-t border-border-light px-4 py-3">
          {footer}
        </div>
      )}
    </div>
  )
  if (floating) return <div className="fixed top-24 right-8 z-50">{card}</div>
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--color-scrim)' }}
      onMouseDown={onClose}
    >
      {card}
    </div>
  )
}

export function Button({
  children,
  primary,
  danger,
  onClick,
  disabled,
  autoFocus
}: {
  children: ReactNode
  primary?: boolean
  danger?: boolean
  onClick: () => void
  disabled?: boolean
  autoFocus?: boolean
}): React.JSX.Element {
  const cls = primary
    ? 'bg-brand text-white hover:bg-brand-light border-transparent'
    : danger
      ? 'bg-surface-white text-error border-border hover:bg-surface-light'
      : 'bg-surface-white text-text border-border hover:bg-surface-light'
  return (
    <button
      type="button"
      disabled={disabled}
      data-autofocus={autoFocus ? true : undefined}
      className={`h-8 rounded-[var(--radius-control)] border px-3 text-ui font-medium disabled:opacity-50 ${cls}`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export const inputClass =
  'h-8 w-full rounded-[var(--radius-control)] border border-input-border bg-input-bg px-2 text-ui text-text outline-none focus:border-input-focus'

export function Field({
  label,
  children
}: {
  label: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-meta text-text-secondary">{label}</span>
      {children}
    </label>
  )
}

export function Check({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <label className="mb-1.5 flex cursor-pointer items-center gap-2 text-ui">
      <input
        type="checkbox"
        className="accent-[var(--color-brand)]"
        checked={checked}
        onChange={(e) => {
          onChange(e.target.checked)
        }}
      />
      {label}
    </label>
  )
}
