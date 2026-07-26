import { useState } from 'react'
import { Drawer } from './Overlay'
import { Avatar, Button, TrashIcon } from './Primitives'
import { byAccessThenName, memberAccess, memberRole, nextMemberColor } from '../lib/board'
import { validateEmail } from '../lib/validate'
import type { Identity } from '../lib/auth'
import type { BoardMember, Label, Member, Task } from '../lib/types'

/* ==========================================================================
   Team & labels panel. Also where the guest session is explained, since "why
   can't I see my tasks on my phone?" is the obvious question an anonymous-auth
   app invites.

   The team list is READ-ONLY on purpose. There used to be a form here for
   typing in a name and getting an assignable person who didn't exist anywhere.
   Members are now created by a database trigger when someone actually joins the
   board, so this list can only ever show real people — and a name on a card
   always corresponds to somebody who was really there.

   Adding people happens in the Share panel, by link.
   ========================================================================== */

interface Props {
  members: Member[]
  labels: Label[]
  tasks: Task[]
  /** Accounts with access right now, used to tell who has since left. */
  access: BoardMember[]
  identity: Identity
  onClose: () => void
  onCreateLabel: (name: string, color: string) => void
  onDeleteLabel: (id: string) => void
  onResetSession: () => void
  onStartUpgrade: (email: string) => Promise<void>
  onSignOut: () => void
  onOpenShare: () => void
}

export function TeamPanel({
  members,
  labels,
  tasks,
  access,
  identity,
  onClose,
  onCreateLabel,
  onDeleteLabel,
  onResetSession,
  onStartUpgrade,
  onSignOut,
  onOpenShare,
}: Props) {
  const [labelName, setLabelName] = useState('')
  const [labelColor, setLabelColor] = useState(nextMemberColor(labels.length + 3))
  const [confirmReset, setConfirmReset] = useState(false)

  const roster = [...members].sort(byAccessThenName(access))
  const activeCount = roster.filter((m) => memberAccess(m, access) === 'active').length

  const addLabel = () => {
    if (!labelName.trim()) return
    onCreateLabel(labelName, labelColor)
    setLabelName('')
    setLabelColor(nextMemberColor(labels.length + 4))
  }

  const taskCountFor = (memberId: string) =>
    tasks.filter((t) => t.assignee_ids.includes(memberId)).length

  const labelCountFor = (labelId: string) =>
    tasks.filter((t) => t.label_ids.includes(labelId)).length

  return (
    <Drawer title="Team & labels" subtitle="Board setup" onClose={onClose}>
      {/* ---- Team (read-only) ---------------------------------------------- */}
      <section className="detail__section">
        <h3 className="detail__h">
          Team
          {activeCount > 0 && <span className="detail__hcount">{activeCount}</span>}
        </h3>
        <p className="detail__muted">
          Everyone who has opened a share link for this board. You can assign work to any of
          them.
        </p>

        {roster.length === 0 ? (
          <p className="detail__muted">Nobody yet.</p>
        ) : (
          <ul className="roster">
            {roster.map((m) => {
              const state = memberAccess(m, access)
              const role = memberRole(m, access)
              const isYou = m.auth_user_id === identity.userId
              const count = taskCountFor(m.id)
              return (
                <li
                  key={m.id}
                  className={`roster__row${state === 'revoked' ? ' roster__row--gone' : ''}`}
                >
                  <Avatar member={m} size={28} showTooltip={false} />
                  <span className="roster__name">
                    {isYou ? 'You' : m.name}
                    {m.email && <em className="roster__sub">{m.email}</em>}
                  </span>
                  <span className="roster__count">
                    {state === 'revoked' ? (
                      /* The row is kept on purpose: deleting it would strip this
                         person off every card they were assigned to and leave
                         gaps in the activity log. */
                      <span className="roster__gone" title="Removed from this board">
                        no longer has access
                      </span>
                    ) : (
                      role
                    )}
                    {count > 0 && ` · ${count} ${count === 1 ? 'task' : 'tasks'}`}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        {!identity.isGuest && (
          <div className="inline-form">
            <Button variant="ghost" size="sm" onClick={onOpenShare}>
              Invite someone
            </Button>
          </div>
        )}
      </section>

      {/* ---- Labels -------------------------------------------------------- */}
      <section className="detail__section">
        <h3 className="detail__h">Labels</h3>
        <p className="detail__muted">Tag tasks, then filter the board by them from the toolbar.</p>

        {labels.length > 0 && (
          <ul className="roster">
            {labels.map((l) => (
              <li key={l.id} className="roster__row">
                <span className="swatch swatch--lg" style={{ background: l.color }} />
                <span className="roster__name">{l.name}</span>
                <span className="roster__count">
                  {labelCountFor(l.id)} {labelCountFor(l.id) === 1 ? 'task' : 'tasks'}
                </span>
                <button
                  className="icon-btn icon-btn--sm"
                  onClick={() => onDeleteLabel(l.id)}
                  aria-label={`Delete label ${l.name}`}
                  title={`Delete label ${l.name}`}
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            addLabel()
          }}
        >
          <ColorPicker value={labelColor} onChange={setLabelColor} label="Label colour" />
          <input
            className="input input--sm"
            value={labelName}
            onChange={(e) => setLabelName(e.target.value)}
            placeholder="Add a label…"
            maxLength={30}
            aria-label="New label name"
          />
          <Button variant="primary" size="sm" type="submit" disabled={!labelName.trim()}>
            Add
          </Button>
        </form>
      </section>

      {/* ---- Account / session --------------------------------------------- */}
      <section className="detail__section detail__section--last">
        <h3 className="detail__h">{identity.isGuest ? 'This guest session' : 'Your account'}</h3>

        {identity.isGuest ? (
          <>
            <p className="detail__muted">
              You're signed in anonymously. Everything here belongs to the id below, and Row Level
              Security in Postgres makes it unreadable to anyone else — including other guests on
              this same deployment.
            </p>
            <code className="session-id">{identity.userId}</code>
            <p className="detail__muted">
              The session lives in this browser's local storage, so this device keeps its board. A
              different browser gets a different id and a separate board.
            </p>

            <UpgradeBox onStartUpgrade={onStartUpgrade} />

            {confirmReset ? (
              <div className="confirm">
                <span className="confirm__text">
                  Start a brand-new guest session? This board stays in the database but this browser
                  won't be able to reach it again.
                </span>
                <div className="modal__actions">
                  <Button variant="quiet" onClick={() => setConfirmReset(false)}>
                    Cancel
                  </Button>
                  <Button variant="danger" onClick={onResetSession}>
                    New session
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)}>
                Start a new guest session
              </Button>
            )}
          </>
        ) : (
          <>
            <p className="detail__muted">
              Signed in as <strong>{identity.email}</strong>. You can log in from any device and
              this board follows you.
            </p>
            <code className="session-id">{identity.userId}</code>
            <p className="detail__muted">
              That id is what every Row Level Security policy checks. It is not a secret — knowing
              it grants nothing without your session.
            </p>
            <Button variant="ghost" size="sm" onClick={onSignOut}>
              Sign out
            </Button>
          </>
        )}
      </section>
    </Drawer>
  )
}

/** Guest → account, step one: collect an email and send the confirmation link.
 *  No password here — Supabase rejects one until the address is verified. */
function UpgradeBox({ onStartUpgrade }: { onStartUpgrade: (email: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  if (sent) {
    return (
      <div className="upgrade upgrade--sent">
        <p className="detail__muted">
          Confirmation link sent to <strong>{email}</strong>. Click it and you'll come back here to
          set a password. Your board stays exactly as it is.
        </p>
      </div>
    )
  }

  if (!open) {
    return (
      <div className="upgrade">
        <p className="upgrade__pitch">
          <strong>Keep this board for good.</strong> Add an email and password and it stops being
          tied to this browser — nothing on it moves or is lost.
        </p>
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          Save this board to an account
        </Button>
      </div>
    )
  }

  return (
    <form
      className="upgrade"
      onSubmit={async (e) => {
        e.preventDefault()
        const err = validateEmail(email)
        setError(err)
        if (err) return
        setBusy(true)
        try {
          await onStartUpgrade(email)
          setSent(true)
        } catch (submitError) {
          setError(submitError instanceof Error ? submitError.message : String(submitError))
        } finally {
          setBusy(false)
        }
      }}
    >
      <label className="field__label" htmlFor="upgrade-email">
        Your email
      </label>
      <input
        id="upgrade-email"
        className={`input input--sm${error ? ' input--invalid' : ''}`}
        type="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        value={email}
        onChange={(e) => {
          setEmail(e.target.value)
          if (error) setError(null)
        }}
        aria-invalid={Boolean(error)}
      />
      {error && <p className="field__error">{error}</p>}
      <div className="upgrade__actions">
        <Button variant="primary" size="sm" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send confirmation link'}
        </Button>
        <button type="button" className="link-btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/**
 * Any colour, not a fixed palette.
 *
 * This is the native `<input type="color">` styled to look like a swatch,
 * rather than a hand-built picker. The browser's own picker gets eyedroppers,
 * hex entry, recent colours and full keyboard and screen-reader support for
 * free — none of which a bespoke grid of ten dots would have.
 *
 * It also happens to match the database exactly: the column is
 * `check (color ~ '^#[0-9a-fA-F]{6}$')`, and this input can only ever produce
 * `#rrggbb`.
 */
function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (c: string) => void
  label: string
}) {
  return (
    <input
      type="color"
      className="colorpick__input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      title={`${label} — ${value}`}
    />
  )
}
