import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { friendlyError } from '../lib/supabase'
import {
  createBoard,
  deleteBoard,
  leaveBoard,
  listBoards,
  recallBoard,
  rememberBoard,
  renameBoard,
} from '../lib/boards'
import type { Board } from '../lib/types'

/* ==========================================================================
   useBoards — which boards you can reach, and which one is on screen.

   Deliberately separate from useBoard: this hook is about the *set* of boards
   and changes rarely, while useBoard churns constantly with task edits. Keeping
   them apart stops a drag from re-rendering the board switcher.
   ========================================================================== */

type State = 'loading' | 'ready' | 'error'

export interface UseBoards {
  boards: Board[]
  activeId: string | null
  active: Board | null
  state: State
  error: string | null
  notice: string | null
  dismissNotice: () => void

  select: (boardId: string) => void
  refresh: () => Promise<Board[]>
  create: (name: string) => Promise<string | null>
  rename: (boardId: string, name: string) => Promise<void>
  remove: (boardId: string) => Promise<void>
  leave: (boardId: string, userId: string) => Promise<void>
}

export function useBoards(userId: string | null): UseBoards {
  const [boards, setBoards] = useState<Board[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [state, setState] = useState<State>('loading')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const refresh = useCallback(async (): Promise<Board[]> => {
    if (!userId) return []
    try {
      const next = await listBoards()
      if (!alive.current) return next
      setBoards(next)
      setState('ready')
      setError(null)

      // Keep the current selection if it still exists; otherwise fall back to
      // the remembered one, then to the first board available.
      setActiveId((current) => {
        if (current && next.some((b) => b.id === current)) return current
        const remembered = recallBoard()
        if (remembered && next.some((b) => b.id === remembered)) return remembered
        return next[0]?.id ?? null
      })
      return next
    } catch (err) {
      if (alive.current) {
        setState('error')
        setError(friendlyError(err))
      }
      return []
    }
  }, [userId])

  useEffect(() => {
    if (!userId) {
      setBoards([])
      setActiveId(null)
      setState('loading')
      return
    }
    setState('loading')
    void refresh()
  }, [userId, refresh])

  const select = useCallback((boardId: string) => {
    setActiveId(boardId)
    rememberBoard(boardId)
  }, [])

  const create = useCallback(
    async (name: string): Promise<string | null> => {
      try {
        const id = await createBoard(name)
        await refresh()
        select(id)
        return id
      } catch (err) {
        setNotice(friendlyError(err))
        return null
      }
    },
    [refresh, select],
  )

  const rename = useCallback(
    async (boardId: string, name: string) => {
      const snapshot = boards
      setBoards((prev) => prev.map((b) => (b.id === boardId ? { ...b, name } : b)))
      try {
        await renameBoard(boardId, name)
      } catch (err) {
        if (alive.current) {
          setBoards(snapshot)
          setNotice(friendlyError(err))
        }
      }
    },
    [boards],
  )

  const remove = useCallback(
    async (boardId: string) => {
      try {
        await deleteBoard(boardId)
        const next = await refresh()
        // refresh() already re-picks a board, but be explicit: if the deleted
        // one was active we want the switch to be obvious, not silent.
        if (next.length > 0) select(next[0].id)
      } catch (err) {
        setNotice(friendlyError(err))
      }
    },
    [refresh, select],
  )

  const leave = useCallback(
    async (boardId: string, uid: string) => {
      try {
        await leaveBoard(boardId, uid)
        const next = await refresh()
        if (next.length > 0) select(next[0].id)
      } catch (err) {
        setNotice(friendlyError(err))
      }
    },
    [refresh, select],
  )

  const active = useMemo(
    () => boards.find((b) => b.id === activeId) ?? null,
    [boards, activeId],
  )

  return {
    boards,
    activeId,
    active,
    state,
    error,
    notice,
    dismissNotice: () => setNotice(null),
    select,
    refresh,
    create,
    rename,
    remove,
    leave,
  }
}
