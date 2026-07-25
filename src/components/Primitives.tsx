import type { ReactNode } from 'react'
import { formatDue, initials, urgencyOf } from '../lib/board'
import type { Label, Member, Priority, Status } from '../lib/types'

/* ==========================================================================
   Small presentational pieces, shared across the board and the detail panel.
   All stateless — they take data and render it.
   ========================================================================== */

export function Avatar({
  member,
  size = 24,
  showTooltip = true,
}: {
  member: Member
  size?: number
  showTooltip?: boolean
}) {
  return (
    <span
      className="avatar"
      style={{
        // Inline styles here because the colour is user data, not a token.
        '--avatar-size': `${size}px`,
        '--avatar-color': member.color,
      } as React.CSSProperties}
      title={showTooltip ? member.name : undefined}
      aria-label={member.name}
    >
      {initials(member.name)}
    </span>
  )
}

export function AvatarStack({ members, max = 3 }: { members: Member[]; max?: number }) {
  if (!members.length) return null
  const shown = members.slice(0, max)
  const extra = members.length - shown.length
  return (
    <div className="avatar-stack">
      {shown.map((m) => (
        <Avatar key={m.id} member={m} />
      ))}
      {extra > 0 && (
        <span className="avatar avatar--more" title={members.slice(max).map((m) => m.name).join(', ')}>
          +{extra}
        </span>
      )}
    </div>
  )
}

export function LabelChip({ label, onRemove }: { label: Label; onRemove?: () => void }) {
  return (
    <span
      className="chip"
      style={{ '--chip-color': label.color } as React.CSSProperties}
    >
      {label.name}
      {onRemove && (
        <button className="chip__x" onClick={onRemove} aria-label={`Remove label ${label.name}`}>
          ×
        </button>
      )}
    </span>
  )
}

/* Priority is shown as a stack of pencil strokes rather than a coloured word —
   it reads at a glance without adding another block of text to the card. */
export function PriorityMark({ priority, withLabel = false }: { priority: Priority; withLabel?: boolean }) {
  const bars = priority === 'high' ? 3 : priority === 'normal' ? 2 : 1
  return (
    <span className={`prio prio--${priority}`} title={`${priority} priority`}>
      <span className="prio__bars" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <i key={i} className={i < bars ? 'on' : ''} />
        ))}
      </span>
      {withLabel && <span className="prio__text">{priority}</span>}
      <span className="sr-only">{priority} priority</span>
    </span>
  )
}

/** Due-date pill. Colour and wording escalate as the date approaches. */
export function DueBadge({ dueDate, status }: { dueDate: string | null; status: Status }) {
  if (!dueDate) return null
  const urgency = urgencyOf(dueDate, status)

  // Completed tasks keep the date but drop the alarm colouring.
  if (!urgency) {
    return (
      <span className="due due--muted">
        <ClockIcon />
        {formatDue(dueDate)}
      </span>
    )
  }

  return (
    <span className={`due due--${urgency}`}>
      {urgency === 'overdue' ? <AlertIcon /> : <ClockIcon />}
      {formatDue(dueDate)}
    </span>
  )
}

export function Button({
  children,
  onClick,
  variant = 'ghost',
  size = 'md',
  type = 'button',
  disabled,
  title,
  full,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'quiet' | 'danger'
  size?: 'sm' | 'md'
  type?: 'button' | 'submit'
  disabled?: boolean
  title?: string
  full?: boolean
}) {
  return (
    <button
      type={type}
      className={`btn btn--${variant} btn--${size}${full ? ' btn--full' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  )
}

/* ---- Icons: inline 16px strokes, currentColor, no icon dependency -------- */

export function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 5v3.2l2 1.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function AlertIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
      <path
        d="M8 2.6 14 13H2L8 2.6Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8 6.6v2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.2" r="0.75" fill="currentColor" />
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function CommentIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
      <path
        d="M13.5 7.6c0 2.5-2.4 4.5-5.5 4.5-.7 0-1.4-.1-2-.3L3 13l.6-2.2C2.9 10 2.5 8.9 2.5 7.6c0-2.5 2.4-4.5 5.5-4.5s5.5 2 5.5 4.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path
        d="M3.5 5h9M6.5 5V3.6h3V5M4.6 5l.5 8h5.8l.5-8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function GripIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      {[4, 8, 12].map((y) =>
        [6, 10].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.15" fill="currentColor" />),
      )}
    </svg>
  )
}
