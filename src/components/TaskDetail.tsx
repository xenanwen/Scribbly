import { useEffect, useState } from 'react'
import { Drawer } from './Overlay'
import { useTaskThread } from '../hooks/useTaskThread'
import {
  Avatar,
  Button,
  DueBadge,
  PriorityMark,
  TrashIcon,
} from './Primitives'
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  initials,
  relativeTime,
} from '../lib/board'
import { PRIORITIES, STATUSES } from '../lib/types'
import type { Activity, Label, Member, Priority, Status, Task, TaskPatch } from '../lib/types'

/* ==========================================================================
   Task detail panel: edit every field, read the comment thread, and see the
   full activity timeline.

   Editing model: fields save on blur (text) or immediately on click (choices).
   No Save button, because there is nothing to batch — each field is its own
   small UPDATE, and the optimistic layer means the change is on screen before
   the request finishes.
   ========================================================================== */

interface Props {
  task: Task
  members: Member[]
  labels: Label[]
  onClose: () => void
  onUpdate: (id: string, patch: TaskPatch) => void
  onDelete: (id: string) => void
  onSetAssignees: (taskId: string, memberIds: string[]) => void
  onSetLabels: (taskId: string, labelIds: string[]) => void
}

export function TaskDetail({
  task,
  members,
  labels,
  onClose,
  onUpdate,
  onDelete,
  onSetAssignees,
  onSetLabels,
}: Props) {
  const { comments, activity, loading, error, addComment, deleteComment } = useTaskThread(task.id)
  const [tab, setTab] = useState<'comments' | 'activity'>('comments')
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Keep local drafts in step if the task changes underneath us (realtime, or
  // a drag that happened while this panel was open).
  useEffect(() => setTitle(task.title), [task.title])
  useEffect(() => setDescription(task.description ?? ''), [task.description])

  const commitTitle = () => {
    const clean = title.trim()
    if (!clean) {
      setTitle(task.title) // never allow an empty title; revert instead
      return
    }
    if (clean !== task.title) onUpdate(task.id, { title: clean })
  }

  const commitDescription = () => {
    const next = description.trim() || null
    if (next !== (task.description ?? null)) onUpdate(task.id, { description: next })
  }

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

  return (
    <Drawer
      title={
        <textarea
          className="detail__title"
          value={title}
          rows={1}
          maxLength={200}
          aria-label="Task title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
            if (e.key === 'Escape') {
              setTitle(task.title)
              e.currentTarget.blur()
            }
          }}
        />
      }
      subtitle={
        <span className="detail__crumb">
          {STATUS_LABEL[task.status]} · opened {relativeTime(task.created_at)}
        </span>
      }
      onClose={onClose}
      footer={
        confirmDelete ? (
          <div className="confirm">
            <span className="confirm__text">Delete this task and its comments?</span>
            <div className="modal__actions">
              <Button variant="quiet" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  onDelete(task.id)
                  onClose()
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <button className="danger-link" onClick={() => setConfirmDelete(true)}>
            <TrashIcon />
            Delete task
          </button>
        )
      }
    >
      {/* ---- Properties ---------------------------------------------------- */}
      <section className="detail__section">
        <Row label="Column">
          <div className="segmented segmented--sm" role="group" aria-label="Column">
            {STATUSES.map((s: Status) => (
              <button
                key={s}
                className={`segmented__item${task.status === s ? ' is-on' : ''}`}
                onClick={() => task.status !== s && onUpdate(task.id, { status: s })}
                aria-pressed={task.status === s}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </Row>

        <Row label="Priority">
          <div className="segmented segmented--sm" role="group" aria-label="Priority">
            {PRIORITIES.map((p: Priority) => (
              <button
                key={p}
                className={`segmented__item${task.priority === p ? ' is-on' : ''}`}
                onClick={() => task.priority !== p && onUpdate(task.id, { priority: p })}
                aria-pressed={task.priority === p}
              >
                <PriorityMark priority={p} />
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
        </Row>

        <Row label="Due">
          <div className="detail__due">
            <input
              className="input input--sm"
              type="date"
              value={task.due_date ?? ''}
              aria-label="Due date"
              onChange={(e) => onUpdate(task.id, { due_date: e.target.value || null })}
            />
            <DueBadge dueDate={task.due_date} status={task.status} />
            {task.due_date && (
              <button className="link-btn" onClick={() => onUpdate(task.id, { due_date: null })}>
                Clear
              </button>
            )}
          </div>
        </Row>

        <Row label="Assignees">
          {members.length === 0 ? (
            <p className="detail__muted">No team members yet — add some from the Team panel.</p>
          ) : (
            <div className="pickers">
              {members.map((m) => (
                <button
                  key={m.id}
                  className={`picker${task.assignee_ids.includes(m.id) ? ' is-on' : ''}`}
                  onClick={() => onSetAssignees(task.id, toggle(task.assignee_ids, m.id))}
                  aria-pressed={task.assignee_ids.includes(m.id)}
                >
                  <Avatar member={m} size={20} showTooltip={false} />
                  {m.name}
                </button>
              ))}
            </div>
          )}
        </Row>

        <Row label="Labels">
          {labels.length === 0 ? (
            <p className="detail__muted">No labels yet — create some from the Team panel.</p>
          ) : (
            <div className="pickers">
              {labels.map((l) => (
                <button
                  key={l.id}
                  className={`picker${task.label_ids.includes(l.id) ? ' is-on' : ''}`}
                  onClick={() => onSetLabels(task.id, toggle(task.label_ids, l.id))}
                  aria-pressed={task.label_ids.includes(l.id)}
                >
                  <span className="swatch" style={{ background: l.color }} />
                  {l.name}
                </button>
              ))}
            </div>
          )}
        </Row>
      </section>

      {/* ---- Description --------------------------------------------------- */}
      <section className="detail__section">
        <h3 className="detail__h">Description</h3>
        <textarea
          className="input input--paper"
          rows={4}
          value={description}
          placeholder="Add more detail…"
          maxLength={5000}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={commitDescription}
        />
      </section>

      {/* ---- Comments / Activity ------------------------------------------- */}
      <section className="detail__section">
        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'comments'}
            className={`tabs__tab${tab === 'comments' ? ' is-on' : ''}`}
            onClick={() => setTab('comments')}
          >
            Comments{comments.length > 0 && <span className="tabs__count">{comments.length}</span>}
          </button>
          <button
            role="tab"
            aria-selected={tab === 'activity'}
            className={`tabs__tab${tab === 'activity' ? ' is-on' : ''}`}
            onClick={() => setTab('activity')}
          >
            Activity
          </button>
        </div>

        {error && <p className="field__error">{error}</p>}

        {loading ? (
          <div className="thread-loading">
            <div className="shimmer shimmer--line" />
            <div className="shimmer shimmer--line short" />
          </div>
        ) : tab === 'comments' ? (
          <CommentThread
            comments={comments}
            members={members}
            onAdd={addComment}
            onDelete={deleteComment}
          />
        ) : (
          <Timeline activity={activity} />
        )}
      </section>
    </Drawer>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prow">
      <span className="prow__label">{label}</span>
      <div className="prow__value">{children}</div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function CommentThread({
  comments,
  members,
  onAdd,
  onDelete,
}: {
  comments: import('../lib/types').Comment[]
  members: Member[]
  onAdd: (body: string, authorId: string | null) => void
  onDelete: (id: string) => void
}) {
  const [body, setBody] = useState('')
  const [authorId, setAuthorId] = useState<string | null>(members[0]?.id ?? null)

  const send = () => {
    if (!body.trim()) return
    onAdd(body, authorId)
    setBody('')
  }

  return (
    <div className="thread">
      {comments.length === 0 ? (
        <p className="detail__muted">No comments yet. Leave the first note.</p>
      ) : (
        <ul className="thread__list">
          {comments.map((c) => {
            const author = members.find((m) => m.id === c.author_id)
            return (
              <li key={c.id} className={`comment${c.id.startsWith('temp-') ? ' is-pending' : ''}`}>
                <span
                  className="avatar"
                  style={
                    {
                      '--avatar-size': '26px',
                      '--avatar-color': author?.color ?? 'var(--ink-faint)',
                    } as React.CSSProperties
                  }
                  aria-hidden="true"
                >
                  {author ? initials(author.name) : '·'}
                </span>
                <div className="comment__body">
                  <div className="comment__meta">
                    <strong>{author?.name ?? 'You'}</strong>
                    <time dateTime={c.created_at} title={new Date(c.created_at).toLocaleString()}>
                      {relativeTime(c.created_at)}
                    </time>
                    <button
                      className="comment__del"
                      onClick={() => onDelete(c.id)}
                      aria-label="Delete comment"
                    >
                      ×
                    </button>
                  </div>
                  <p className="comment__text">{c.body}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="composer">
        {members.length > 0 && (
          <select
            className="composer__author"
            value={authorId ?? ''}
            onChange={(e) => setAuthorId(e.target.value || null)}
            aria-label="Comment as"
          >
            <option value="">You</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        <textarea
          className="input input--paper"
          rows={2}
          value={body}
          placeholder="Write a comment…  (⌘ + Enter to send)"
          maxLength={2000}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="composer__foot">
          <Button variant="primary" size="sm" onClick={send} disabled={!body.trim()}>
            Comment
          </Button>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function Timeline({ activity }: { activity: Activity[] }) {
  if (activity.length === 0) {
    return <p className="detail__muted">Nothing recorded yet.</p>
  }
  return (
    <ol className="timeline">
      {activity.map((a) => (
        <li key={a.id} className={`tl tl--${a.kind}`}>
          <span className="tl__dot" aria-hidden="true" />
          <span className="tl__text">{describe(a)}</span>
          <time className="tl__time" dateTime={a.created_at} title={new Date(a.created_at).toLocaleString()}>
            {relativeTime(a.created_at)}
          </time>
        </li>
      ))}
    </ol>
  )
}

/** Turn an activity row into a sentence. The DB stores the raw status keys, so
 *  translate them here rather than storing display strings. */
function describe(a: Activity): React.ReactNode {
  const asStatus = (v: string | null) =>
    v && v in STATUS_LABEL ? STATUS_LABEL[v as Status] : (v ?? '—')

  switch (a.kind) {
    case 'created':
      return 'Created this task'
    case 'status':
      return (
        <>
          Moved from <b>{asStatus(a.from_value)}</b> → <b>{asStatus(a.to_value)}</b>
        </>
      )
    case 'edited':
      return <>Updated the {a.from_value ?? 'task'}</>
    case 'assigned':
      return (
        <>
          Assigned <b>{a.to_value}</b>
        </>
      )
    case 'unassigned':
      return (
        <>
          Unassigned <b>{a.to_value}</b>
        </>
      )
    case 'labeled':
      return (
        <>
          Added label <b>{a.to_value}</b>
        </>
      )
    case 'unlabeled':
      return (
        <>
          Removed label <b>{a.to_value}</b>
        </>
      )
    case 'commented':
      return <>Commented: “{a.to_value}”</>
    default:
      return a.kind
  }
}
