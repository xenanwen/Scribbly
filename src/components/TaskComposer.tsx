import { useState } from 'react'
import { Modal } from './Overlay'
import { Avatar, Button, PriorityMark } from './Primitives'
import { PRIORITY_LABEL, STATUS_LABEL, todayISO } from '../lib/board'
import { PRIORITIES, STATUSES } from '../lib/types'
import type { Label, Member, NewTaskInput, Priority, Status } from '../lib/types'

/* ==========================================================================
   Full "New task" form. The inline quick-add in each column covers the common
   case (title only); this is for when you want to set everything up front.
   ========================================================================== */

interface Props {
  initialStatus: Status
  members: Member[]
  labels: Label[]
  onClose: () => void
  onCreate: (input: NewTaskInput) => void
}

export function TaskComposer({ initialStatus, members, labels, onClose, onCreate }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<Status>(initialStatus)
  const [priority, setPriority] = useState<Priority>('normal')
  const [dueDate, setDueDate] = useState('')
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [labelIds, setLabelIds] = useState<string[]>([])
  const [touched, setTouched] = useState(false)

  const titleError = touched && !title.trim() ? 'Give the task a title.' : null

  const submit = () => {
    setTouched(true)
    if (!title.trim()) return
    onCreate({
      title,
      description: description.trim() || null,
      status,
      priority,
      due_date: dueDate || null,
      assignee_ids: assigneeIds,
      label_ids: labelIds,
    })
    onClose()
  }

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

  return (
    <Modal
      title="New task"
      onClose={onClose}
      footer={
        <>
          <span className="modal__hint">⌘ + Enter to save</span>
          <div className="modal__actions">
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit}>
              Add task
            </Button>
          </div>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="task-title">
            Title
          </label>
          <input
            id="task-title"
            className={`input input--lg${titleError ? ' input--invalid' : ''}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="Write the copy for the landing page"
            maxLength={200}
            aria-invalid={Boolean(titleError)}
            aria-describedby={titleError ? 'task-title-error' : undefined}
          />
          {titleError && (
            <p className="field__error" id="task-title-error">
              {titleError}
            </p>
          )}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="task-desc">
            Description <span className="field__optional">optional</span>
          </label>
          <textarea
            id="task-desc"
            className="input"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Any detail worth remembering later"
            maxLength={5000}
          />
        </div>

        <div className="field-row">
          <div className="field">
            <span className="field__label">Column</span>
            <div className="segmented" role="group" aria-label="Column">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`segmented__item${status === s ? ' is-on' : ''}`}
                  onClick={() => setStatus(s)}
                  aria-pressed={status === s}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <span className="field__label">Priority</span>
            <div className="segmented" role="group" aria-label="Priority">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`segmented__item${priority === p ? ' is-on' : ''}`}
                  onClick={() => setPriority(p)}
                  aria-pressed={priority === p}
                >
                  <PriorityMark priority={p} />
                  {PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
          </div>

          <div className="field field--narrow">
            <label className="field__label" htmlFor="task-due">
              Due date <span className="field__optional">optional</span>
            </label>
            <input
              id="task-due"
              className="input"
              type="date"
              value={dueDate}
              min="1970-01-01"
              onChange={(e) => setDueDate(e.target.value)}
            />
            {dueDate && dueDate < todayISO() && (
              <p className="field__warn">That date has already passed.</p>
            )}
          </div>
        </div>

        {members.length > 0 && (
          <div className="field">
            <span className="field__label">Assignees</span>
            <div className="pickers">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`picker${assigneeIds.includes(m.id) ? ' is-on' : ''}`}
                  onClick={() => setAssigneeIds(toggle(assigneeIds, m.id))}
                  aria-pressed={assigneeIds.includes(m.id)}
                >
                  <Avatar member={m} size={20} showTooltip={false} />
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {labels.length > 0 && (
          <div className="field">
            <span className="field__label">Labels</span>
            <div className="pickers">
              {labels.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={`picker${labelIds.includes(l.id) ? ' is-on' : ''}`}
                  onClick={() => setLabelIds(toggle(labelIds, l.id))}
                  aria-pressed={labelIds.includes(l.id)}
                  style={{ '--picker-color': l.color } as React.CSSProperties}
                >
                  <span className="swatch" style={{ background: l.color }} />
                  {l.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
    </Modal>
  )
}
