import { useCallback, useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragOverEvent, DragStartEvent, UniqueIdentifier } from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { Column } from './Column'
import { TaskCard } from './TaskCard'
import {
  COLUMNS,
  byPosition,
  groupByStatus,
  hasActiveFilters,
  isStatus,
  matchesFilters,
  needsRebalance,
  positionBetween,
} from '../lib/board'
import type { BoardData, Filters, Status, Task } from '../lib/types'

/* ==========================================================================
   The board + all drag-and-drop wiring.

   HOW A DRAG WORKS HERE

   1. onDragStart  — remember which card is moving; the real card goes
                     translucent and a tilted copy follows the cursor in
                     DragOverlay.
   2. onDragOver   — if the pointer crosses into a different column, write a
                     `draft` copy of the task list where that card already
                     belongs to the new column at the hovered index. That is
                     what makes the other cards part to make room, instead of
                     the card only appearing to move once you let go.
   3. onDragEnd    — work out the final index, convert it to a fractional
                     `position` (see positionBetween), and persist status +
                     position in a single UPDATE. The optimistic state in
                     useBoard means the card never visibly snaps back.

   Reordering *within* a column needs no draft state at all — dnd-kit's sortable
   strategy handles the live transforms, and we only compute the final index on
   drop.
   ========================================================================== */

interface Props {
  data: BoardData
  filters: Filters
  onOpenTask: (id: string) => void
  onQuickAdd: (status: Status, title: string) => void
  onOpenComposer: (status: Status) => void
  onClearFilters: () => void
  moveTask: (id: string, status: Status, position: number) => Promise<void>
  rebalanceColumn: (status: Status) => Promise<void>
}

export function Board({
  data,
  filters,
  onOpenTask,
  onQuickAdd,
  onOpenComposer,
  onClearFilters,
  moveTask,
  rebalanceColumn,
}: Props) {
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null)
  const [overColumn, setOverColumn] = useState<Status | null>(null)
  /** Non-null only while a cross-column drag is in progress. */
  const [draft, setDraft] = useState<Task[] | null>(null)

  const filtersActive = hasActiveFilters(filters)

  const visible = useMemo(
    () => data.tasks.filter((t) => matchesFilters(t, filters)),
    [data.tasks, filters],
  )

  // While dragging we render the draft so the layout previews the drop.
  const source = draft ?? visible
  const grouped = useMemo(() => groupByStatus(source), [source])

  const sensors = useSensors(
    // A few pixels of travel before a drag begins, so a tap still counts as a
    // click on the card.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // On touch, require a short hold. Without the delay, swiping to scroll the
    // column would pick up whichever card was under your thumb.
    useSensor(TouchSensor, { activationConstraint: { delay: 170, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  /** Which column does this id live in? Ids are either a task id or a status. */
  const containerOf = useCallback(
    (id: UniqueIdentifier, list: Task[]): Status | null => {
      const asString = String(id)
      if (isStatus(asString)) return asString
      return list.find((t) => t.id === asString)?.status ?? null
    },
    [],
  )

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(active.id)
    setOverColumn(containerOf(active.id, visible))
    document.body.classList.add('is-dragging')
  }

  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return

    const activeIdStr = String(active.id)
    // Hovering over its own placeholder is not a move. Without this guard the
    // card would be excluded from the target list, find no index, and jump to
    // the bottom of the column.
    if (String(over.id) === activeIdStr) return

    const list = draft ?? visible
    const current = list.find((t) => t.id === activeIdStr)
    if (!current) return

    const to = containerOf(over.id, list)
    if (!to) return
    setOverColumn(to)

    // A drag that has never left its home column is handled entirely by
    // dnd-kit's sortable strategy — taking it over here would fight the live
    // transforms. Once the card crosses into another column we own the preview
    // from then on, including any further moves back and forth.
    if (to === current.status && draft === null) return

    setDraft(() => {
      const target = list.filter((t) => t.status === to && t.id !== activeIdStr).sort(byPosition)

      const overString = String(over.id)
      const idx = isStatus(overString) ? target.length : target.findIndex((t) => t.id === overString)
      // Hovering a card means "insert above it"; hovering the column body means
      // "put it at the end".
      const insertAt = idx < 0 ? target.length : idx

      const provisional = positionBetween(target[insertAt - 1], target[insertAt])

      return list.map((t) =>
        t.id === activeIdStr ? { ...t, status: to, position: provisional } : t,
      )
    })
  }

  const finishDrag = () => {
    setActiveId(null)
    setOverColumn(null)
    setDraft(null)
    document.body.classList.remove('is-dragging')
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const activeIdStr = String(active.id)

    if (!over) {
      finishDrag()
      return
    }

    /* CROSS-COLUMN: the draft already holds the exact status and position the
       user is looking at, so commit that rather than recomputing from `over`.
       Recomputing here is what made a card land one slot below its preview:
       the draft has already inserted the card into the column, which shifts
       every index the `over` card reports. */
    if (draft) {
      const moved = draft.find((t) => t.id === activeIdStr)
      if (!moved) {
        finishDrag()
        return
      }

      const column = draft.filter((t) => t.status === moved.status).sort(byPosition)
      const at = column.findIndex((t) => t.id === activeIdStr)
      const before = column[at - 1]
      const after = column[at + 1]

      const original = data.tasks.find((t) => t.id === activeIdStr)
      const unchanged =
        original && original.status === moved.status && original.position === moved.position

      finishDrag()
      if (unchanged) return

      void moveTask(activeIdStr, moved.status, moved.position).then(() => {
        if (needsRebalance(before, after)) void rebalanceColumn(moved.status)
      })
      return
    }

    /* SAME-COLUMN: no draft was taken, so derive the new index from `over` and
       reorder with arrayMove. */
    const list = visible
    const to = containerOf(over.id, list)
    if (!to) {
      finishDrag()
      return
    }

    const column = list.filter((t) => t.status === to).sort(byPosition)
    const oldIndex = column.findIndex((t) => t.id === activeIdStr)
    if (oldIndex < 0) {
      finishDrag()
      return
    }

    const overString = String(over.id)
    let newIndex = isStatus(overString)
      ? column.length - 1
      : column.findIndex((t) => t.id === overString)
    if (newIndex < 0) newIndex = column.length - 1

    const reordered = arrayMove(column, oldIndex, newIndex)
    const before = reordered[newIndex - 1]
    const after = reordered[newIndex + 1]
    const position = positionBetween(before, after)

    // Compare against the *persisted* task, not the draft, so a drag that ends
    // where it started writes nothing.
    const original = data.tasks.find((t) => t.id === activeIdStr)
    const unchanged = original && original.status === to && original.position === position

    finishDrag()

    if (unchanged) return

    void moveTask(activeIdStr, to, position).then(() => {
      // Floats can only be halved so many times before they collide. When the
      // gap gets too small, renumber this column onto clean integers.
      if (needsRebalance(before, after)) void rebalanceColumn(to)
    })
  }

  const activeTask = activeId ? source.find((t) => t.id === String(activeId)) : undefined

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      // Cards change height as labels/avatars appear, so cached rects go stale.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={finishDrag}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up ${labelFor(active.id, source)}.`,
          onDragOver: ({ active, over }) =>
            over
              ? `${labelFor(active.id, source)} is over ${zoneName(over.id, source)}.`
              : `${labelFor(active.id, source)} is no longer over a drop zone.`,
          onDragEnd: ({ active, over }) =>
            over
              ? `Dropped ${labelFor(active.id, source)} into ${zoneName(over.id, source)}.`
              : `Dropped ${labelFor(active.id, source)}. It returned to where it started.`,
          onDragCancel: ({ active }) => `Cancelled moving ${labelFor(active.id, source)}.`,
        },
      }}
    >
      <div className="board">
        {COLUMNS.map((col) => (
          <Column
            key={col.status}
            status={col.status}
            title={col.title}
            accent={col.accent}
            hint={col.hint}
            tasks={grouped[col.status]}
            members={data.members}
            labels={data.labels}
            filtered={filtersActive}
            isDraggingOver={activeId !== null && overColumn === col.status}
            onOpen={onOpenTask}
            onQuickAdd={onQuickAdd}
            onClearFilters={onClearFilters}
            onOpenComposer={onOpenComposer}
          />
        ))}
      </div>

      {/* The card that follows the cursor. Rendering it here rather than moving
          the original keeps it above every column's overflow clipping. */}
      <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.32,0.72,0,1)' }}>
        {activeTask ? (
          <TaskCard
            task={activeTask}
            members={data.members}
            labels={data.labels}
            onOpen={() => {}}
            overlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

/* ---- Screen-reader announcement helpers --------------------------------- */

function labelFor(id: UniqueIdentifier, tasks: Task[]): string {
  return tasks.find((t) => t.id === String(id))?.title ?? 'task'
}

function zoneName(id: UniqueIdentifier, tasks: Task[]): string {
  const asString = String(id)
  if (isStatus(asString)) {
    return COLUMNS.find((c) => c.status === asString)?.title ?? asString
  }
  const task = tasks.find((t) => t.id === asString)
  if (!task) return 'a drop zone'
  const column = COLUMNS.find((c) => c.status === task.status)?.title ?? task.status
  return `${column}, near ${task.title}`
}
