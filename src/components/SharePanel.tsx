import { useCallback, useEffect, useState } from 'react'
import { Drawer } from './Overlay'
import { Button, TrashIcon } from './Primitives'
import { friendlyError } from '../lib/supabase'
import {
  createInvite,
  inviteUrl,
  listBoardMembers,
  listInvites,
  removeBoardMember,
  revokeInvite,
  setMemberRole,
} from '../lib/boards'
import { initials, relativeTime } from '../lib/board'
import type { Board, BoardMember, Invite, Member, Role } from '../lib/types'

/* ==========================================================================
   Sharing a board.

   Joining is by secret link rather than by email, and that's a deliberate
   choice worth understanding: auth.users is not readable from the browser, so
   "does this email have an account?" would need service_role in an Edge
   Function — and any answer shown to the inviter is an oracle for who is
   registered. A link needs none of that, and works for people who haven't
   signed up yet.

   Guests can be *given* a link but can't create one. A board owned by an
   anonymous session that disappears when the browser is cleared is a bad thing
   to own, so sharing requires an account.
   ========================================================================== */

interface Props {
  board: Board
  /** Assignable member records, used to put names to the account ids. */
  members: Member[]
  currentUserId: string
  isGuest: boolean
  onClose: () => void
  onRename: (name: string) => void
  onDelete: () => void
  onLeave: () => void
  onUpgradePrompt: () => void
}

export function SharePanel({
  board,
  members,
  currentUserId,
  isGuest,
  onClose,
  onRename,
  onDelete,
  onLeave,
  onUpgradePrompt,
}: Props) {
  const isOwner = board.role === 'owner'

  const [people, setPeople] = useState<BoardMember[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [newRole, setNewRole] = useState<Exclude<Role, 'owner'>>('editor')
  const [name, setName] = useState(board.name)
  const [confirmDanger, setConfirmDanger] = useState(false)

  useEffect(() => setName(board.name), [board.name])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [p, i] = await Promise.all([
        listBoardMembers(board.id),
        // Only owners can read invites; don't even ask otherwise.
        isOwner ? listInvites(board.id) : Promise.resolve([]),
      ])
      setPeople(p)
      setInvites(i)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }, [board.id, isOwner])

  useEffect(() => {
    void reload()
  }, [reload])

  /** Put a name to an account id using the assignable member records — that's
   *  the only place an email is stored, since auth.users is off limits. */
  const describe = (userId: string): { label: string; sub: string | null } => {
    const linked = members.find((m) => m.auth_user_id === userId)
    if (userId === currentUserId) {
      return { label: 'You', sub: linked?.email ?? null }
    }
    if (linked) return { label: linked.name, sub: linked.email }
    return { label: 'Teammate', sub: `${userId.slice(0, 8)}…` }
  }

  const makeLink = async () => {
    if (isGuest) {
      onUpgradePrompt()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const token = await createInvite(board.id, { role: newRole, expiresIn: '14 days' })
      await navigator.clipboard.writeText(inviteUrl(token)).catch(() => {
        // Clipboard can be blocked; the link still appears in the list below.
      })
      setCopied(token)
      await reload()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(inviteUrl(token))
      setCopied(token)
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 2000)
    } catch {
      setError('Your browser blocked the clipboard. Select the link and copy it manually.')
    }
  }

  return (
    <Drawer
      title="Share this board"
      subtitle={board.role === 'owner' ? 'You own this board' : `You're a ${board.role}`}
      onClose={onClose}
    >
      {/* ---- Board name --------------------------------------------------- */}
      <section className="detail__section">
        <h3 className="detail__h">Board name</h3>
        {isOwner ? (
          <input
            className="input"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const clean = name.trim()
              if (clean && clean !== board.name) onRename(clean)
              else setName(board.name)
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            aria-label="Board name"
          />
        ) : (
          <p className="detail__muted">{board.name}</p>
        )}
      </section>

      {/* ---- People with access ------------------------------------------- */}
      <section className="detail__section">
        <h3 className="detail__h">People with access</h3>
        {error && <p className="field__error">{error}</p>}

        {loading ? (
          <div className="thread-loading">
            <div className="shimmer shimmer--line" />
            <div className="shimmer shimmer--line short" />
          </div>
        ) : (
          <ul className="roster">
            {people.map((p) => {
              const who = describe(p.user_id)
              return (
                <li key={p.user_id} className="roster__row">
                  <span
                    className="avatar"
                    style={
                      {
                        '--avatar-size': '28px',
                        '--avatar-color':
                          members.find((m) => m.auth_user_id === p.user_id)?.color ??
                          'var(--ink-faint)',
                      } as React.CSSProperties
                    }
                    aria-hidden="true"
                  >
                    {initials(who.label)}
                  </span>
                  <span className="roster__name">
                    {who.label}
                    {who.sub && <em className="roster__sub">{who.sub}</em>}
                  </span>

                  {p.role === 'owner' || !isOwner || p.user_id === currentUserId ? (
                    <span className="roster__count">{p.role}</span>
                  ) : (
                    <select
                      className="composer__author"
                      value={p.role}
                      aria-label={`Role for ${who.label}`}
                      onChange={async (e) => {
                        try {
                          await setMemberRole(
                            board.id,
                            p.user_id,
                            e.target.value as Exclude<Role, 'owner'>,
                          )
                          await reload()
                        } catch (err) {
                          setError(friendlyError(err))
                        }
                      }}
                    >
                      <option value="editor">editor</option>
                      <option value="viewer">viewer</option>
                    </select>
                  )}

                  {isOwner && p.user_id !== currentUserId && (
                    <button
                      className="icon-btn icon-btn--sm"
                      title={`Remove ${who.label}`}
                      aria-label={`Remove ${who.label}`}
                      onClick={async () => {
                        try {
                          await removeBoardMember(board.id, p.user_id)
                          await reload()
                        } catch (err) {
                          setError(friendlyError(err))
                        }
                      }}
                    >
                      <TrashIcon />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* ---- Invite links ------------------------------------------------- */}
      {isOwner && (
        <section className="detail__section">
          <h3 className="detail__h">Invite links</h3>
          <p className="detail__muted">
            Anyone signed in who opens the link joins this board. Treat it like a password —
            it's the only thing standing between the link and your tasks. Links expire after
            14 days and can be revoked at any time.
          </p>

          {isGuest ? (
            <div className="upgrade">
              <p className="upgrade__pitch">
                <strong>Sharing needs an account.</strong> A guest board lives in this browser
                only, so there'd be nothing dependable for your teammates to come back to.
              </p>
              <Button variant="primary" size="sm" onClick={onUpgradePrompt}>
                Save this board to an account
              </Button>
            </div>
          ) : (
            <>
              <div className="inline-form">
                <select
                  className="composer__author"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as Exclude<Role, 'owner'>)}
                  aria-label="Access level for the new link"
                >
                  <option value="editor">can edit</option>
                  <option value="viewer">can view</option>
                </select>
                <Button variant="primary" size="sm" onClick={() => void makeLink()} disabled={busy}>
                  {busy ? 'Creating…' : 'Create link'}
                </Button>
              </div>

              {invites.length === 0 ? (
                <p className="detail__muted">No active links.</p>
              ) : (
                <ul className="roster">
                  {invites.map((inv) => (
                    <li key={inv.id} className="roster__row">
                      <code className="invite-token">{inviteUrl(inv.token)}</code>
                      <span className="roster__count">
                        {inv.role}
                        {inv.expires_at ? ` · expires ${relativeTime(inv.expires_at)}` : ''}
                      </span>
                      <button className="link-btn" onClick={() => void copy(inv.token)}>
                        {copied === inv.token ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        className="icon-btn icon-btn--sm"
                        title="Revoke this link"
                        aria-label="Revoke this link"
                        onClick={async () => {
                          try {
                            await revokeInvite(inv.id)
                            await reload()
                          } catch (err) {
                            setError(friendlyError(err))
                          }
                        }}
                      >
                        <TrashIcon />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      {/* ---- Danger zone -------------------------------------------------- */}
      <section className="detail__section detail__section--last">
        <h3 className="detail__h">{isOwner ? 'Delete board' : 'Leave board'}</h3>
        {confirmDanger ? (
          <div className="confirm">
            <span className="confirm__text">
              {isOwner
                ? 'Delete this board and everything on it? Every task, comment and label goes with it, for everyone. This cannot be undone.'
                : "Leave this board? You'll lose access until someone sends you a new link."}
            </span>
            <div className="modal__actions">
              <Button variant="quiet" onClick={() => setConfirmDanger(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={isOwner ? onDelete : onLeave}>
                {isOwner ? 'Delete' : 'Leave'}
              </Button>
            </div>
          </div>
        ) : (
          <button className="danger-link" onClick={() => setConfirmDanger(true)}>
            <TrashIcon />
            {isOwner ? 'Delete this board' : 'Leave this board'}
          </button>
        )}
      </section>
    </Drawer>
  )
}
