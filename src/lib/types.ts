/* ==========================================================================
   Domain types. These mirror supabase/schema.sql exactly — if you change a
   CHECK constraint there, change the union here.
   ========================================================================== */

export const STATUSES = ['todo', 'in_progress', 'in_review', 'done'] as const
export type Status = (typeof STATUSES)[number]

export const PRIORITIES = ['low', 'normal', 'high'] as const
export type Priority = (typeof PRIORITIES)[number]

/* ---- Boards & sharing ---------------------------------------------------- */

export const ROLES = ['owner', 'editor', 'viewer'] as const
export type Role = (typeof ROLES)[number]

export interface Board {
  id: string
  name: string
  owner_id: string
  created_at: string
  /** The calling user's role on this board, joined in from board_members. */
  role: Role
}

/** A person with access to the board — an actual account, unlike Member. */
export interface BoardMember {
  board_id: string
  user_id: string
  role: Role
  joined_at: string
}

export interface Invite {
  id: string
  board_id: string
  token: string
  role: Exclude<Role, 'owner'>
  created_at: string
  expires_at: string | null
  revoked_at: string | null
  max_uses: number | null
  uses: number
}

export function canEdit(role: Role): boolean {
  return role === 'owner' || role === 'editor'
}

/* ---- Board content ------------------------------------------------------- */

/** An assignable person on a board. Not necessarily an account: a member is a
 *  name you can put on a card, and `auth_user_id` is set only for those who
 *  actually joined. */
export interface Member {
  id: string
  name: string
  color: string
  created_at: string
  email: string | null
  auth_user_id: string | null
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
  /** Accounts with access right now. A Member whose auth_user_id is absent from
   *  this list had access once and lost it — their row is kept deliberately so
   *  cards don't silently lose an assignee. */
  access: BoardMember[]
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
