import { useState } from 'react'
import { Drawer } from './Overlay'
import { Avatar, Button, TrashIcon } from './Primitives'
import { MEMBER_COLORS, nextMemberColor } from '../lib/board'
import { validateEmail } from '../lib/validate'
import type { Identity } from '../lib/auth'
import type { Label, Member, Task } from '../lib/types'

/* ==========================================================================
   Team & labels panel. Also the place where the guest session is explained,
   since "why can't I see my tasks on my phone?" is the obvious question an
   anonymous-auth app invites.
   ========================================================================== */

interface Props {
  members: Member[]
  labels: Label[]
  tasks: Task[]
  identity: Identity
  onClose: () => void
  onCreateMember: (name: string, color: string) => void
  onDeleteMember: (id: string) => void
  onCreateLabel: (name: string, color: string) => void
  onDeleteLabel: (id: string) => void
  onResetSession: () => void
  onStartUpgrade: (email: string) => Promise<void>
  onSignOut: () => void
}

export function TeamPanel({
  members,
  labels,
  tasks,
  identity,
  onClose,
  onCreateMember,
  onDeleteMember,
  onCreateLabel,
  onDeleteLabel,
  onResetSession,
  onStartUpgrade,
  onSignOut,
}: Props) {
  const [memberName, setMemberName] = useState('')
  const [memberColor, setMemberColor] = useState(nextMemberColor(members.length))
  const [labelName, setLabelName] = useState('')
  const [labelColor, setLabelColor] = useState(nextMemberColor(labels.length + 3))
  const [confirmReset, setConfirmReset] = useState(false)

  const addMember = () => {
    if (!memberName.trim()) return
    onCreateMember(memberName, memberColor)
    setMemberName('')
    setMemberColor(nextMemberColor(members.length + 1))
  }

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
      {/* ---- Members ------------------------------------------------------- */}
      <section className="detail__section">
        <h3 className="detail__h">Team members</h3>
        <p className="detail__muted">
          Lightweight names to assign work to — not real accounts, so there's nobody to invite.
        </p>

        {members.length > 0 && (
          <ul className="roster">
            {members.map((m) => (
              <li key={m.id} className="roster__row">
                <Avatar member={m} size={28} showTooltip={false} />
                <span className="roster__name">{m.name}</span>
                <span className="roster__count">
                  {taskCountFor(m.id) || 0} {taskCountFor(m.id) === 1 ? 'task' : 'tasks'}
                </span>
                <button
                  className="icon-btn icon-btn--sm"
                  onClick={() => onDeleteMember(m.id)}
                  aria-label={`Remove ${m.name}`}
                  title={`Remove ${m.name}`}
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
            addMember()
          }}
        >
          <ColorPicker value={memberColor} onChange={setMemberColor} label="Member colour" />
          <input
            className="input input--sm"
            value={memberName}
            onChange={(e) => setMemberName(e.target.value)}
            placeholder="Add a teammate…"
            maxLength={60}
            aria-label="New team member name"
          />
          <Button variant="primary" size="sm" type="submit" disabled={!memberName.trim()}>
            Add
          </Button>
        </form>
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

function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (c: string) => void
  label: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="colorpick">
      <button
        type="button"
        className="colorpick__current"
        style={{ background: value }}
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
      />
      {open && (
        <div className="colorpick__grid">
          {MEMBER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`colorpick__dot${c === value ? ' is-on' : ''}`}
              style={{ background: c }}
              onClick={() => {
                onChange(c)
                setOpen(false)
              }}
              aria-label={c}
            />
          ))}
        </div>
      )}
    </div>
  )
}
