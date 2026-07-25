import { memo } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AvatarStack, DueBadge, GripIcon, LabelChip, PriorityMark } from './Primitives'
import { urgencyOf } from '../lib/board'
import type { Label, Member, Task } from '../lib/types'

/* ==========================================================================
   A single task card.

   Interaction model, which is the fiddly part of any Kanban board:

   * POINTER drag works from anywhere on the card. The sortable `listeners` are
     spread on the <article>, which has no tabIndex — so its onKeyDown never
     fires and cannot fight with "Enter opens the task".
   * KEYBOARD drag works from the grip button, which is the registered activator
     node. Tab to it, press Space, then use the arrow keys.
   * OPENING the task is a real <button> around the title, so it is reachable by
     keyboard and announced properly. The card's own onClick is a convenience
     for mouse users and stops at the title button to avoid firing twice.
   ========================================================================== */

interface Props {
  task: Task
  members: Member[]
  labels: Label[]
  onOpen: (id: string) => void
  /** True for the copy rendered inside DragOverlay. */
  overlay?: boolean
}

function TaskCardInner({ task, members, labels, onOpen, overlay = false }: Props) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({
      id: task.id,
      data: { type: 'task', status: task.status },
    })

  const urgency = urgencyOf(task.due_date, task.status)
  const assignees = members.filter((m) => task.assignee_ids.includes(m.id))
  const chips = labels.filter((l) => task.label_ids.includes(l.id))

  const classes = [
    'card',
    task.status === 'done' && 'card--done',
    urgency === 'overdue' && 'card--overdue',
    isDragging && 'card--dragging',
    overlay && 'card--overlay',
    task.id.startsWith('temp-') && 'card--pending',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article
      ref={overlay ? undefined : setNodeRef}
      className={classes}
      style={
        overlay
          ? undefined
          : { transform: CSS.Translate.toString(transform), transition }
      }
      onClick={() => onOpen(task.id)}
      {...(overlay ? {} : listeners)}
    >
      {/* Colour-coded spine: label colour if the task has one, else priority. */}
      <span
        className="card__spine"
        style={{ background: chips[0]?.color ?? 'transparent' }}
        aria-hidden="true"
      />

      {chips.length > 0 && (
        <div className="card__labels">
          {chips.map((l) => (
            <LabelChip key={l.id} label={l} />
          ))}
        </div>
      )}

      <h3 className="card__title">
        <button
          className="card__open"
          onClick={(e) => {
            e.stopPropagation()
            onOpen(task.id)
          }}
        >
          {task.title}
        </button>
      </h3>

      {task.description && <p className="card__desc">{task.description}</p>}

      <footer className="card__foot">
        <div className="card__meta">
          <PriorityMark priority={task.priority} />
          <DueBadge dueDate={task.due_date} status={task.status} />
        </div>
        <div className="card__right">
          <AvatarStack members={assignees} />
          {!overlay && (
            <button
              ref={setActivatorNodeRef}
              className="card__grip"
              onClick={(e) => e.stopPropagation()}
              {...attributes}
              {...listeners}
              aria-label={`Reorder ${task.title}. Press space, then use the arrow keys.`}
            >
              <GripIcon />
            </button>
          )}
        </div>
      </footer>
    </article>
  )
}

/* The board can hold a few hundred cards; memoising stops every card in every
   column from re-rendering on each pointer move during a drag. */
export const TaskCard = memo(TaskCardInner)
