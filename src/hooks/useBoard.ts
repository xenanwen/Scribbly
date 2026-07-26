import { useCallback, useEffect, useRef, useState } from 'react'
import { friendlyError, supabase } from '../lib/supabase'
import { rebalance, toTask } from '../lib/board'
import type {
  BoardData,
  BoardMember,
  Label,
  Member,
  NewTaskInput,
  Status,
  Task,
  TaskPatch,
  TaskRow,
} from '../lib/types'

/* ==========================================================================
   useBoard — everything on one board.

   Keyed on boardId, not on the user: several people can hold the same board
   open, and one person can have several boards. RLS decides whether the board
   is reachable at all, so this hook never checks permissions itself — it just
   asks, and surfaces the refusal if one comes back.

   Three things worth knowing:

   * OPTIMISTIC WRITES. State updates first, then the network. On failure the
     exact pre-change snapshot is restored and a dismissible notice appears.
     That's what makes dragging feel instant.

   * ONE QUERY per collection. Tasks come back with their join rows embedded,
     so first paint is 3 requests rather than 3 + 2N.

   * CONFLICT DETECTION on moves. Now that two people can drag the same card,
     `moveTask` guards its UPDATE with the `updated_at` it last saw. If someone
     else got there first the guard matches nothing, and rather than silently
     overwriting them we refetch and say so.
   ========================================================================== */

type LoadState = 'loading' | 'ready' | 'error'

const EMPTY: BoardData = { tasks: [], members: [], labels: [], access: [] }

const TASK_SELECT = '*, task_assignees(member_id), task_labels(label_id)'

export interface UseBoard {
  data: BoardData
  loadState: LoadState
  loadError: string | null
  syncing: boolean
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

  /* No createMember/deleteMember: members are created by a database trigger when
     someone joins the board, and kept when they leave. There is no longer any
     way — from the UI or the API — to invent a person who doesn't exist. */
  createLabel: (name: string, color: string) => Promise<void>
  deleteLabel: (id: string) => Promise<void>
}

export function useBoard(boardId: string | null): UseBoard {
  const [data, setDataState] = useState<BoardData>(EMPTY)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /* A ref mirror of state. Mutations need the *current* board synchronously to
     build their rollback snapshot; reading `data` from a closure would give a
     stale value when two drags happen back to back. */
  const dataRef = useRef<BoardData>(EMPTY)
  const setData = useCallback((next: BoardData | ((prev: BoardData) => BoardData)) => {
    const resolved = typeof next === 'function' ? next(dataRef.current) : next
    dataRef.current = resolved
    setDataState(resolved)
  }, [])

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

  const fetchAll = useCallback(async (id: string): Promise<BoardData> => {
    const [tasksRes, membersRes, labelsRes, accessRes] = await Promise.all([
      supabase.from('tasks').select(TASK_SELECT).eq('board_id', id),
      supabase.from('members').select('*').eq('board_id', id).order('created_at'),
      supabase.from('labels').select('*').eq('board_id', id).order('created_at'),
      // Who currently has access. Needed to tell an active member from one who
      // has left — their Member row is deliberately kept either way.
      supabase.from('board_members').select('*').eq('board_id', id).order('joined_at'),
    ])
    if (tasksRes.error) throw tasksRes.error
    if (membersRes.error) throw membersRes.error
    if (labelsRes.error) throw labelsRes.error
    if (accessRes.error) throw accessRes.error

    return {
      tasks: ((tasksRes.data ?? []) as TaskRow[]).map(toTask),
      members: (membersRes.data ?? []) as Member[],
      labels: (labelsRes.data ?? []) as Label[],
      access: (accessRes.data ?? []) as BoardMember[],
    }
  }, [])

  const load = useCallback(
    async (mode: 'initial' | 'silent') => {
      if (!boardId) return
      if (mode === 'initial') {
        setLoadState('loading')
        setLoadError(null)
      }
      try {
        const next = await fetchAll(boardId)
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
    [boardId, fetchAll, setData],
  )

  // Switching boards must clear the old one's contents immediately, or the
  // previous board's cards flash on screen under the new board's name.
  useEffect(() => {
    if (!boardId) {
      setData(EMPTY)
      setLoadState('loading')
      return
    }
    setData(EMPTY)
    void load('initial')
  }, [boardId, load, setData])

  const refresh = useCallback(() => load('initial'), [load])

  /* ---- Realtime -------------------------------------------------------- */

  useEffect(() => {
    if (!boardId) return

    const scheduleRefetch = () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current)
      refetchTimer.current = setTimeout(() => {
        // Our own optimistic state is already correct; don't fight it.
        if (pendingWrites.current === 0) void load('silent')
      }, 400)
    }

    /* Filtered to this board, so a collaborator's change arrives but nobody
       else's does — and RLS applies to realtime too, so the filter is a
       performance choice rather than the security boundary. */
    const channel = supabase
      .channel(`board:${boardId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `board_id=eq.${boardId}` },
        scheduleRefetch,
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [boardId, load])

  /* ---- Write helper ---------------------------------------------------- */

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
      if (!title || !boardId) return

      const status = input.status ?? 'todo'
      const siblings = dataRef.current.tasks.filter((t) => t.status === status)
      const position = siblings.length ? Math.max(...siblings.map((t) => t.position)) + 1000 : 1000

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
        // user_id comes from the DEFAULT auth.uid(); we only choose the board,
        // and RLS checks we're allowed to write to it.
        const { data: inserted, error } = await supabase
          .from('tasks')
          .insert({
            board_id: boardId,
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

        // board_id on the join rows is overwritten by a BEFORE trigger that
        // reads it off the parent task, so it can't be spoofed. Sent anyway to
        // satisfy the NOT NULL before the trigger runs.
        if (optimistic.assignee_ids.length) {
          const { error: aErr } = await supabase.from('task_assignees').insert(
            optimistic.assignee_ids.map((member_id) => ({
              task_id: realId,
              member_id,
              board_id: boardId,
            })),
          )
          if (aErr) throw aErr
        }
        if (optimistic.label_ids.length) {
          const { error: lErr } = await supabase.from('task_labels').insert(
            optimistic.label_ids.map((label_id) => ({
              task_id: realId,
              label_id,
              board_id: boardId,
            })),
          )
          if (lErr) throw lErr
        }

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
    [boardId, setData, beginWrite, endWrite],
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

  /**
   * The drop handler. Status and position move together in one round trip.
   *
   * The `.eq('updated_at', …)` is optimistic concurrency: it only matches if
   * nobody has touched this row since we read it. Zero rows back means a
   * collaborator moved the same card first, so we reload rather than quietly
   * overwrite their change — last-write-wins is fine alone and wrong in company.
   */
  const moveTask = useCallback(
    async (id: string, status: Status, position: number) => {
      const before = dataRef.current
      const current = before.tasks.find((t) => t.id === id)
      if (!current) return

      const expected = current.updated_at
      setData((prev) => ({
        ...prev,
        tasks: prev.tasks.map((t) => (t.id === id ? { ...t, status, position } : t)),
      }))
      beginWrite()

      try {
        const { data: rows, error } = await supabase
          .from('tasks')
          .update({ status, position })
          .eq('id', id)
          .eq('updated_at', expected)
          .select('id')
        if (error) throw error

        if (!rows || rows.length === 0) {
          if (alive.current) {
            setNotice('Someone else moved that card first — the board has been refreshed.')
            await load('silent')
          }
        }
      } catch (err) {
        if (alive.current) {
          setData(before)
          setNotice(friendlyError(err))
        }
      } finally {
        endWrite()
      }
    },
    [setData, beginWrite, endWrite, load],
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

  /** Diff-based: only added/removed rows are written, so the activity log reads
   *  "assigned Sam" rather than a churn of delete-all then insert-all. */
  const syncLinks = useCallback(
    (
      table: 'task_assignees' | 'task_labels',
      column: 'member_id' | 'label_id',
      key: 'assignee_ids' | 'label_ids',
      taskId: string,
      nextIds: string[],
    ) => {
      if (!boardId) return Promise.resolve()
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
              .insert(added.map((id) => ({ task_id: taskId, [column]: id, board_id: boardId })))
            if (error) throw error
          }
        },
      )
    },
    [write, boardId],
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

  /* ---- Labels ---------------------------------------------------------- */

  const createLabel = useCallback(
    async (name: string, color: string) => {
      const clean = name.trim()
      if (!clean || !boardId) return
      const { data: row, error } = await supabase
        .from('labels')
        .insert({ name: clean, color, board_id: boardId })
        .select()
        .single()
      if (error) {
        setNotice(friendlyError(error))
        return
      }
      setData((prev) => ({ ...prev, labels: [...prev.labels, row as Label] }))
    },
    [setData, boardId],
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
    createLabel,
    deleteLabel,
  }
}
