import { useState } from 'react'
import { Drawer } from './Overlay'
import { Avatar, Button, TrashIcon } from './Primitives'
import { MEMBER_COLORS, nextMemberColor } from '../lib/board'
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
  userId: string
  onClose: () => void
  onCreateMember: (name: string, color: string) => void
  onDeleteMember: (id: string) => void
  onCreateLabel: (name: string, color: string) => void
  onDeleteLabel: (id: string) => void
  onResetSession: () => void
}

export function TeamPanel({
  members,
  labels,
  tasks,
  userId,
  onClose,
  onCreateMember,
  onDeleteMember,
  onCreateLabel,
  onDeleteLabel,
  onResetSession,
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

      {/* ---- Session ------------------------------------------------------- */}
      <section className="detail__section detail__section--last">
        <h3 className="detail__h">This guest session</h3>
        <p className="detail__muted">
          You're signed in anonymously. Everything on this board belongs to the guest id below, and
          Row Level Security in Postgres makes it unreadable to anyone else — including other guests
          on this same deployment.
        </p>
        <code className="session-id">{userId}</code>
        <p className="detail__muted">
          The session lives in this browser's local storage, so this device keeps its board. A
          different browser gets a different guest id and a fresh, separate board.
        </p>

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
      </section>
    </Drawer>
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
