/* ==========================================================================
   Domain types. These mirror supabase/schema.sql exactly — if you change a
   CHECK constraint there, change the union here.
   ========================================================================== */

export const STATUSES = ['todo', 'in_progress', 'in_review', 'done'] as const
export type Status = (typeof STATUSES)[number]

export const PRIORITIES = ['low', 'normal', 'high'] as const
export type Priority = (typeof PRIORITIES)[number]

export interface Member {
  id: string
  name: string
  color: string
  created_at: string
}

export interface Label {
  id: string
  name: string
  color: string
  created_at: string
}

/** A task as the UI wants it: join-table rows already flattened to id arrays. */
export interface Task {
  id: string
  title: string
  description: string | null
  status: Status
  priority: Priority
  due_date: string | null
  position: number
  created_at: string
  updated_at: string
  assignee_ids: string[]
  label_ids: string[]
}

export interface Comment {
  id: string
  task_id: string
  author_id: string | null
  body: string
  created_at: string
}

export type ActivityKind =
  | 'created'
  | 'status'
  | 'edited'
  | 'assigned'
  | 'unassigned'
  | 'labeled'
  | 'unlabeled'
  | 'commented'

export interface Activity {
  id: string
  task_id: string
  kind: ActivityKind
  from_value: string | null
  to_value: string | null
  created_at: string
}

/** Shape returned by the board query, before flattening. */
export interface TaskRow {
  id: string
  title: string
  description: string | null
  status: Status
  priority: Priority
  due_date: string | null
  position: number
  created_at: string
  updated_at: string
  task_assignees: { member_id: string }[] | null
  task_labels: { label_id: string }[] | null
}

export interface NewTaskInput {
  title: string
  description?: string | null
  status?: Status
  priority?: Priority
  due_date?: string | null
  assignee_ids?: string[]
  label_ids?: string[]
}

export type TaskPatch = Partial<
  Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'due_date' | 'position'>
>

/** Everything the board needs to render, in one object. */
export interface BoardData {
  tasks: Task[]
  members: Member[]
  labels: Label[]
}

export interface Filters {
  query: string
  priorities: Priority[]
  assigneeIds: string[]
  labelIds: string[]
}

export const EMPTY_FILTERS: Filters = {
  query: '',
  priorities: [],
  assigneeIds: [],
  labelIds: [],
}
