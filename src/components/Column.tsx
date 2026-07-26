import { useEffect, useRef, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { TaskCard } from './TaskCard'
import { EmptyColumn } from './States'
import { PlusIcon } from './Primitives'
import type { Label, Member, Status, Task } from '../lib/types'

/* ==========================================================================
   One board section.

   The whole column body is a droppable, not just the list of cards — otherwise
   an empty column has no drop target and you can never move the first card
   into it.
   ========================================================================== */

interface Props {
  status: Status
  title: string
  accent: string
  hint: string
  tasks: Task[]
  members: Member[]
  labels: Label[]
  filtered: boolean
  isDraggingOver: boolean
  onOpen: (id: string) => void
  onQuickAdd: (status: Status, title: string) => void
  onClearFilters: () => void
  onOpenComposer: (status: Status) => void
  readOnly?: boolean
}

export function Column({
  status,
  title,
  accent,
  hint,
  tasks,
  members,
  labels,
  filtered,
  isDraggingOver,
  onOpen,
  onQuickAdd,
  onClearFilters,
  onOpenComposer,
  readOnly = false,
}: Props) {
  const { setNodeRef } = useDroppable({
    id: status,
    data: { type: 'column', status },
    disabled: readOnly,
  })
  const [adding, setAdding] = useState(false)

  return (
    <section
      className={`column${isDraggingOver ? ' column--over' : ''}`}
      style={{ '--accent': accent } as React.CSSProperties}
      aria-label={`${title}, ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`}
    >
      <header className="column__head">
        <span className="column__rule" style={{ background: accent }} />
        <h2 className="column__title">{title}</h2>
        <span className="column__count">{tasks.length}</span>
        {!readOnly && (
          <button
            className="column__add"
            onClick={() => onOpenComposer(status)}
            aria-label={`Add a task to ${title}`}
            title={`Add a task to ${title}`}
          >
            <PlusIcon />
          </button>
        )}
      </header>
      <p className="column__hint">{hint}</p>

      <div ref={setNodeRef} className="column__body">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              members={members}
              labels={labels}
              onOpen={onOpen}
              readOnly={readOnly}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 && !isDraggingOver && (
          <EmptyColumn
            status={status}
            filtered={filtered}
            onClear={onClearFilters}
            onAdd={() => setAdding(true)}
            readOnly={readOnly}
          />
        )}

        {isDraggingOver && tasks.length === 0 && <div className="drop-hint">Drop here</div>}

        {readOnly ? null : adding ? (
          <QuickAdd
            onCancel={() => setAdding(false)}
            onSubmit={(value) => {
              onQuickAdd(status, value)
              // Stay open: adding several tasks in a row is the common case.
            }}
          />
        ) : (
          <button className="column__quickadd" onClick={() => setAdding(true)}>
            <PlusIcon />
            Add task
          </button>
        )}
      </div>
    </section>
  )
}

/** Inline title-only composer. Enter saves and keeps the box open, Escape
 *  closes, blur on an empty box closes. Same rhythm as Linear's quick add. */
function QuickAdd({
  onSubmit,
  onCancel,
}: {
  onSubmit: (title: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const commit = () => {
    const clean = value.trim()
    if (!clean) return
    onSubmit(clean)
    setValue('')
    ref.current?.focus()
  }

  return (
    <div className="quickadd">
      <textarea
        ref={ref}
        className="quickadd__input"
        value={value}
        rows={2}
        placeholder="What needs doing?"
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            commit()
          }
          if (e.key === 'Escape') onCancel()
        }}
        onBlur={() => {
          if (!value.trim()) onCancel()
        }}
      />
      <div className="quickadd__foot">
        <span className="quickadd__hint">Enter to add · Esc to close</span>
        <button className="quickadd__save" onClick={commit} disabled={!value.trim()}>
          Add
        </button>
      </div>
    </div>
  )
}
