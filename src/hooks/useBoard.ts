import { useCallback, useEffect, useRef, useState } from 'react'
import { friendlyError, supabase } from '../lib/supabase'
import { rebalance, toTask } from '../lib/board'
import type {
  BoardData,
  Label,
  Member,
  NewTaskInput,
  Status,
  Task,
  TaskPatch,
  TaskRow,
} from '../lib/types'

/* ==========================================================================
   useBoard — the app's only stateful data layer.

   Design notes:

   * OPTIMISTIC WRITES. Every mutation updates React state first, then hits the
     network. If the request fails we roll back to the exact snapshot taken
     before the change and surface a message. This is what makes drag-and-drop
     feel instant instead of laggy-then-snappy.

   * ONE QUERY. The board loads tasks with their join rows embedded
     (`task_assignees(member_id)`), so first paint is 3 requests, not 3 + 2N.

   * REALTIME. A Postgres change feed filtered to this user's rows keeps a
     second tab/device in sync. Rather than merging individual payloads (fiddly,
     easy to get wrong), a change triggers a debounced refetch — and refetches
     are suppressed while our own writes are in flight so they can't clobber an
     optimistic update mid-flight.
   ========================================================================== */

type LoadState = 'loading' | 'ready' | 'error'

const EMPTY: BoardData = { tasks: [], members: [], labels: [] }

const TASK_SELECT = '*, task_assignees(member_id), task_labels(label_id)'

export interface UseBoard {
  data: BoardData
  loadState: LoadState
  loadError: string | null
  /** True while any write is in flight — drives the "saving…" hint. */
  syncing: boolean
  /** Non-blocking problems: a failed write, a rejected rename. */
  notice: string | null
  dismissNotice: () => void
  refresh: () => Promise<void>

  createTask: (input: NewTaskInput) => Promise<void>
  updateTask: (id: string, patch: TaskPatch) => Promise<void>
  moveTask: (id: string, status: Status, position: number) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  rebalanceColumn: (status: Status) => Promise<void>

  setAssignees: (taskId: string, memberIds: string[]) => Promise<void>
  setLabels: (taskId: string, labelIds: string[]) => Promise<void>

  createMember: (name: string, color: string) => Promise<void>
  deleteMember: (id: string) => Promise<void>
  createLabel: (name: string, color: string) => Promise<void>
  deleteLabel: (id: string) => Promise<void>
}

export function useBoard(userId: string | null): UseBoard {
  const [data, setDataState] = useState<BoardData>(EMPTY)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /* A ref mirror of state. Mutations need to read the *current* board
     synchronously to build their rollback snapshot; reading `data` from a
     closure would give a stale value when two drags happen back to back. */
  const dataRef = useRef<BoardData>(EMPTY)
  const setData = useCallback((next: BoardData | ((prev: BoardData) => BoardData)) => {
    const resolved = typeof next === 'function' ? next(dataRef.current) : next
    dataRef.current = resolved
    setDataState(resolved)
  }, [])

  /* Writes in flight. The ref is the source of truth (read synchronously by the
     realtime handler); the state copy exists only to render the "saving…" hint. */
  const pendingWrites = useRef(0)
  const [syncing, setSyncing] = useState(false)
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(true)

  const beginWrite = useCallback(() => {
    pendingWrites.current += 1
    setSyncing(true)
  }, [])

  const endWrite = useCallback(() => {
    pendingWrites.current = Math.max(0, pendingWrites.current - 1)
    if (pendingWrites.current === 0) setSyncing(false)
  }, [])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (refetchTimer.current) clearTimeout(refetchTimer.current)
    }
  }, [])

  /* ---- Read ------------------------------------------------------------ */

  const fetchAll = useCallback(async (): Promise<BoardData> => {
    const [tasksRes, membersRes, labelsRes] = await Promise.all([
      supabase.from('tasks').select(TASK_SELECT),
      supabase.from('members').select('*').order('created_at'),
      supabase.from('labels').select('*').order('created_at'),
    ])
    if (tasksRes.error) throw tasksRes.error
    if (membersRes.error) throw membersRes.error
    if (labelsRes.error) throw labelsRes.error

    return {
      tasks: ((tasksRes.data ?? []) as TaskRow[]).map(toTask),
      members: (membersRes.data ?? []) as Member[],
      labels: (labelsRes.data ?? []) as Label[],
    }
  }, [])

  const load = useCallback(
    async (mode: 'initial' | 'silent') => {
      if (!userId) return
      if (mode === 'initial') {
        setLoadState('loading')
        setLoadError(null)
      }
      try {
        const next = await fetchAll()
        if (!alive.current) return
        setData(next)
        setLoadState('ready')
        setLoadError(null)
      } catch (err) {
        if (!alive.current) return
        if (mode === 'initial') {
          setLoadState('error')
          setLoadError(friendlyError(err))
        } else {
          setNotice(friendlyError(err))
        }
      }
    },
    [userId, fetchAll, setData],
  )

  useEffect(() => {
    if (userId) void load('initial')
  }, [userId, load])

  const refresh = useCallback(() => load('initial'), [load])

  /* ---- Realtime -------------------------------------------------------- */

  useEffect(() => {
    if (!userId) return

    const scheduleRefetch = () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current)
      refetchTimer.current = setTimeout(() => {
        // Our own optimistic state is already correct; don't fight it.
        if (pendingWrites.current === 0) void load('silent')
      }, 400)
    }

    const channel = supabase
      .channel(`board:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userId}` },
        scheduleRefetch,
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId, load])

  /* ---- Write helper ---------------------------------------------------- */

  /** Apply an optimistic change, run the network call, roll back on failure. */
  const write = useCallback(
    async (apply: (prev: BoardData) => BoardData, run: () => Promise<void>) => {
      const snapshot = dataRef.current
      setData(apply(snapshot))
      beginWrite()
      try {
        await run()
      } catch (err) {
        if (alive.current) {
          setData(snapshot)
          setNotice(friendlyError(err))
        }
      } finally {
        endWrite()
      }
    },
    [setData, beginWrite, endWrite],
  )

  /* ---- Task mutations -------------------------------------------------- */

  const createTask = useCallback(
    async (input: NewTaskInput) => {
      const title = input.title.trim()
      if (!title) return

      const status = input.status ?? 'todo'
      const siblings = dataRef.current.tasks.filter((t) => t.status === status)
      const position = siblings.length
        ? Math.max(...siblings.map((t) => t.position)) + 1000
        : 1000

      const tempId = `temp-${crypto.randomUUID()}`
      const now = new Date().toISOString()
      const optimistic: Task = {
        id: tempId,
        title,
        description: input.description?.trim() || null,
        status,
        priority: input.priority ?? 'normal',
        due_date: input.due_date || null,
        position,
        created_at: now,
        updated_at: now,
        assignee_ids: input.assignee_ids ?? [],
        label_ids: input.label_ids ?? [],
      }

      const snapshot = dataRef.current
      setData((prev) => ({ ...prev, tasks: [...prev.tasks, optimistic] }))
      beginWrite()

      try {
        // user_id is filled in by the column DEFAULT auth.uid() — the client
        // never gets to choose whose row this is.
        const { data: inserted, error } = await supabase
          .from('tasks')
          .insert({
            title,
            description: optimistic.description,
            status,
            priority: optimistic.priority,
            due_date: optimistic.due_date,
            position,
          })
          .select(TASK_SELECT)
          .single()
        if (error) throw error

        const realId = (inserted as TaskRow).id

        if (optimistic.assignee_ids.length) {
          const { error: aErr } = await supabase
            .from('task_assignees')
            .insert(optimistic.assignee_ids.map((member_id) => ({ task_id: realId, member_id })))
          if (aErr) throw aErr
        }
        if (optimistic.label_ids.length) {
          const { error: lErr } = await supabase
            .from('task_labels')
            .insert(optimistic.label_ids.map((label_id) => ({ task_id: realId, label_id })))
          if (lErr) throw lErr
        }

        // Swap the temp row for the real one, keeping its place in the array.
        if (alive.current) {
          setData((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t) =>
              t.id === tempId
                ? {
                    ...toTask(inserted as TaskRow),
                    assignee_ids: optimistic.assignee_ids,
                    label_ids: optimistic.label_ids,
                  }
                : t,
            ),
          }))
        }
      } catch (err) {
        if (alive.current) {
          setData(snapshot)
          setNotice(friendlyError(err))
        }
      } finally {
        endWrite()
      }
    },
    [setData, beginWrite, endWrite],
  )

  const updateTask = useCallback(
    (id: string, patch: TaskPatch) =>
      write(
        (prev) => ({
          ...prev,
          tasks: prev.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        }),
        async () => {
          const { error } = await supabase.from('tasks').update(patch).eq('id', id)
          if (error) throw error
        },
      ),
    [write],
  )

  /** The drop handler. Status and position move together in one round trip. */
  const moveTask = useCallback(
    (id: string, status: Status, position: number) =>
      write(
        (prev) => ({
          ...prev,
          tasks: prev.tasks.map((t) => (t.id === id ? { ...t, status, position } : t)),
        }),
        async () => {
          const { error } = await supabase.from('tasks').update({ status, position }).eq('id', id)
          if (error) throw error
        },
      ),
    [write],
  )

  const deleteTask = useCallback(
    (id: string) =>
      write(
        (prev) => ({ ...prev, tasks: prev.tasks.filter((t) => t.id !== id) }),
        async () => {
          const { error } = await supabase.from('tasks').delete().eq('id', id)
          if (error) throw error
        },
      ),
    [write],
  )

  /** Rewrite one column's positions onto clean integers when floats get too
   *  close together to split again. Rare — see positionBetween(). */
  const rebalanceColumn = useCallback(
    async (status: Status) => {
      const column = dataRef.current.tasks
        .filter((t) => t.status === status)
        .sort((a, b) => a.position - b.position)
      const updates = rebalance(column)

      await write(
        (prev) => ({
          ...prev,
          tasks: prev.tasks.map((t) => {
            const u = updates.find((x) => x.id === t.id)
            return u ? { ...t, position: u.position } : t
          }),
        }),
        async () => {
          await Promise.all(
            updates.map(({ id, position }) =>
              supabase
                .from('tasks')
                .update({ position })
                .eq('id', id)
                .then(({ error }) => {
                  if (error) throw error
                }),
            ),
          )
        },
      )
    },
    [write],
  )

  /* ---- Join tables ----------------------------------------------------- */

  /** Diff-based: only the added/removed rows are written, so the activity log
   *  records "assigned Sam" rather than a churn of delete-all + insert-all. */
  const syncLinks = useCallback(
    (
      table: 'task_assignees' | 'task_labels',
      column: 'member_id' | 'label_id',
      key: 'assignee_ids' | 'label_ids',
      taskId: string,
      nextIds: string[],
    ) => {
      const current = dataRef.current.tasks.find((t) => t.id === taskId)
      const before = current ? current[key] : []
      const added = nextIds.filter((id) => !before.includes(id))
      const removed = before.filter((id) => !nextIds.includes(id))
      if (!added.length && !removed.length) return Promise.resolve()

      return write(
        (prev) => ({
          ...prev,
          tasks: prev.tasks.map((t) => (t.id === taskId ? { ...t, [key]: nextIds } : t)),
        }),
        async () => {
          if (removed.length) {
            const { error } = await supabase
              .from(table)
              .delete()
              .eq('task_id', taskId)
              .in(column, removed)
            if (error) throw error
          }
          if (added.length) {
            const { error } = await supabase
              .from(table)
              .insert(added.map((id) => ({ task_id: taskId, [column]: id })))
            if (error) throw error
          }
        },
      )
    },
    [write],
  )

  const setAssignees = useCallback(
    (taskId: string, memberIds: string[]) =>
      syncLinks('task_assignees', 'member_id', 'assignee_ids', taskId, memberIds),
    [syncLinks],
  )

  const setLabels = useCallback(
    (taskId: string, labelIds: string[]) =>
      syncLinks('task_labels', 'label_id', 'label_ids', taskId, labelIds),
    [syncLinks],
  )

  /* ---- Members & labels ------------------------------------------------ */

  const createMember = useCallback(
    async (name: string, color: string) => {
      const clean = name.trim()
      if (!clean) return
      const { data: row, error } = await supabase
        .from('members')
        .insert({ name: clean, color })
        .select()
        .single()
      if (error) {
        setNotice(friendlyError(error))
        return
      }
      setData((prev) => ({ ...prev, members: [...prev.members, row as Member] }))
    },
    [setData],
  )

  const deleteMember = useCallback(
    (id: string) =>
      write(
        (prev) => ({
          ...prev,
          members: prev.members.filter((m) => m.id !== id),
          // ON DELETE CASCADE removes the join rows server-side; mirror that
          // locally so avatars disappear from cards immediately.
          tasks: prev.tasks.map((t) => ({
            ...t,
            assignee_ids: t.assignee_ids.filter((a) => a !== id),
          })),
        }),
        async () => {
          const { error } = await supabase.from('members').delete().eq('id', id)
          if (error) throw error
        },
      ),
    [write],
  )

  const createLabel = useCallback(
    async (name: string, color: string) => {
      const clean = name.trim()
      if (!clean) return
      const { data: row, error } = await supabase
        .from('labels')
        .insert({ name: clean, color })
        .select()
        .single()
      if (error) {
        setNotice(friendlyError(error))
        return
      }
      setData((prev) => ({ ...prev, labels: [...prev.labels, row as Label] }))
    },
    [setData],
  )

  const deleteLabel = useCallback(
    (id: string) =>
      write(
        (prev) => ({
          ...prev,
          labels: prev.labels.filter((l) => l.id !== id),
          tasks: prev.tasks.map((t) => ({
            ...t,
            label_ids: t.label_ids.filter((l) => l !== id),
          })),
        }),
        async () => {
          const { error } = await supabase.from('labels').delete().eq('id', id)
          if (error) throw error
        },
      ),
    [write],
  )

  return {
    data,
    loadState,
    loadError,
    syncing,
    notice,
    dismissNotice: () => setNotice(null),
    refresh,
    createTask,
    updateTask,
    moveTask,
    deleteTask,
    rebalanceColumn,
    setAssignees,
    setLabels,
    createMember,
    deleteMember,
    createLabel,
    deleteLabel,
  }
}
