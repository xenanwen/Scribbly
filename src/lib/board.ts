import { STATUSES } from './types'
import type { Filters, Priority, Status, Task, TaskRow } from './types'

/* ==========================================================================
   Pure board logic. No React, no network — everything here is a function of
   its inputs, which makes it the easy part to reason about and to test.
   ========================================================================== */

export const COLUMNS: { status: Status; title: string; accent: string; hint: string }[] = [
  { status: 'todo', title: 'To Do', accent: 'var(--c-todo)', hint: 'Not started yet' },
  { status: 'in_progress', title: 'In Progress', accent: 'var(--c-progress)', hint: 'Being worked on' },
  { status: 'in_review', title: 'In Review', accent: 'var(--c-review)', hint: 'Waiting on feedback' },
  { status: 'done', title: 'Done', accent: 'var(--c-done)', hint: 'Finished' },
]

export const STATUS_LABEL: Record<Status, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
}

export function isStatus(value: string): value is Status {
  return (STATUSES as readonly string[]).includes(value)
}

/** Flatten the nested join rows Postgres returns into plain id arrays. */
export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    due_date: row.due_date,
    position: row.position,
    created_at: row.created_at,
    updated_at: row.updated_at,
    assignee_ids: (row.task_assignees ?? []).map((a) => a.member_id),
    label_ids: (row.task_labels ?? []).map((l) => l.label_id),
  }
}

/* --------------------------------------------------------------------------
   Ordering: fractional indexing.

   Each task stores a `position` float. To drop a card between two neighbours we
   store the midpoint of their positions, so a drag writes exactly ONE row
   instead of renumbering every card below it. Dropping at the start uses
   first/2; at the end, last + STEP.

   Floats do eventually run out of precision if you repeatedly drop between the
   same two cards (~50 times). `needsRebalance` detects that and the caller
   rewrites that column's positions onto clean integers.
   -------------------------------------------------------------------------- */
const STEP = 1000
const MIN_GAP = 0.0001

export function positionBetween(before?: Task, after?: Task): number {
  if (!before && !after) return STEP
  if (!before) return after!.position / 2
  if (!after) return before.position + STEP
  return (before.position + after.position) / 2
}

export function needsRebalance(before?: Task, after?: Task): boolean {
  if (!before || !after) return false
  return Math.abs(after.position - before.position) < MIN_GAP
}

export function rebalance(tasks: Task[]): { id: string; position: number }[] {
  return tasks.map((t, i) => ({ id: t.id, position: (i + 1) * STEP }))
}

/** Sort within a column: explicit position first, creation time as tie-break. */
export function byPosition(a: Task, b: Task): number {
  if (a.position !== b.position) return a.position - b.position
  return a.created_at.localeCompare(b.created_at)
}

/* --------------------------------------------------------------------------
   Filtering & grouping
   -------------------------------------------------------------------------- */

export function matchesFilters(task: Task, f: Filters): boolean {
  const q = f.query.trim().toLowerCase()
  if (q) {
    const haystack = `${task.title} ${task.description ?? ''}`.toLowerCase()
    if (!haystack.includes(q)) return false
  }
  if (f.priorities.length && !f.priorities.includes(task.priority)) return false
  if (f.assigneeIds.length && !f.assigneeIds.some((id) => task.assignee_ids.includes(id))) {
    return false
  }
  if (f.labelIds.length && !f.labelIds.some((id) => task.label_ids.includes(id))) {
    return false
  }
  return true
}

export function hasActiveFilters(f: Filters): boolean {
  return Boolean(
    f.query.trim() || f.priorities.length || f.assigneeIds.length || f.labelIds.length,
  )
}

export function groupByStatus(tasks: Task[]): Record<Status, Task[]> {
  const out = { todo: [], in_progress: [], in_review: [], done: [] } as Record<Status, Task[]>
  for (const t of tasks) out[t.status].push(t)
  for (const s of STATUSES) out[s].sort(byPosition)
  return out
}

/* --------------------------------------------------------------------------
   Dates & urgency. Deliberately timezone-naive: due_date is a calendar day
   (a DATE column), so comparing it as a local Y-M-D string avoids the classic
   "due today shows as overdue because UTC already rolled over" bug.
   -------------------------------------------------------------------------- */

export type Urgency = 'overdue' | 'today' | 'soon' | 'later'

export function todayISO(): string {
  const d = new Date()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function daysUntil(dueDate: string): number {
  const [y, m, d] = dueDate.split('-').map(Number)
  const due = new Date(y, m - 1, d)
  const [ty, tm, td] = todayISO().split('-').map(Number)
  const today = new Date(ty, tm - 1, td)
  return Math.round((due.getTime() - today.getTime()) / 86_400_000)
}

export function urgencyOf(dueDate: string | null, status: Status): Urgency | null {
  if (!dueDate || status === 'done') return null // finished work is never "overdue"
  const days = daysUntil(dueDate)
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days <= 2) return 'soon'
  return 'later'
}

export function formatDue(dueDate: string): string {
  const days = daysUntil(dueDate)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days <= 6) return `in ${days}d`
  const [y, m, d] = dueDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  })
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/* --------------------------------------------------------------------------
   Header stats
   -------------------------------------------------------------------------- */

export interface Stats {
  total: number
  done: number
  overdue: number
  percentDone: number
}

export function computeStats(tasks: Task[]): Stats {
  const total = tasks.length
  const done = tasks.filter((t) => t.status === 'done').length
  const overdue = tasks.filter((t) => urgencyOf(t.due_date, t.status) === 'overdue').length
  return {
    total,
    done,
    overdue,
    percentDone: total === 0 ? 0 : Math.round((done / total) * 100),
  }
}

/** Two initials max, for avatar chips. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Deterministic colour pick so a new member's swatch feels intentional. */
export const MEMBER_COLORS = [
  '#d4756b', '#5b7c99', '#8a9a6b', '#9b7fb5', '#c58a3c',
  '#4f8a6b', '#a8697f', '#6b8c9e', '#b5834f', '#7a7fb5',
]

export function nextMemberColor(usedCount: number): string {
  return MEMBER_COLORS[usedCount % MEMBER_COLORS.length]
}
