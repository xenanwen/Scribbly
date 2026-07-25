import { useCallback, useEffect, useRef, useState } from 'react'
import { friendlyError, supabase } from '../lib/supabase'
import type { Activity, Comment } from '../lib/types'

/* ==========================================================================
   useTaskThread — comments + activity for one task.

   Loaded lazily when the detail panel opens, so the board's first paint never
   pays for data nobody has asked to see yet.
   ========================================================================== */

interface Thread {
  comments: Comment[]
  activity: Activity[]
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  addComment: (body: string, authorId: string | null) => Promise<void>
  deleteComment: (id: string) => Promise<void>
}

export function useTaskThread(taskId: string | null): Thread {
  const [comments, setComments] = useState<Comment[]>([])
  const [activity, setActivity] = useState<Activity[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const load = useCallback(async () => {
    if (!taskId) {
      setComments([])
      setActivity([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [c, a] = await Promise.all([
        supabase
          .from('comments')
          .select('*')
          .eq('task_id', taskId)
          .order('created_at', { ascending: true }),
        supabase
          .from('activity')
          .select('*')
          .eq('task_id', taskId)
          .order('created_at', { ascending: false }),
      ])
      if (c.error) throw c.error
      if (a.error) throw a.error
      if (!alive.current) return
      setComments((c.data ?? []) as Comment[])
      setActivity((a.data ?? []) as Activity[])
    } catch (err) {
      if (alive.current) setError(friendlyError(err))
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    void load()
  }, [load])

  const addComment = useCallback(
    async (body: string, authorId: string | null) => {
      const clean = body.trim()
      if (!clean || !taskId) return

      const temp: Comment = {
        id: `temp-${crypto.randomUUID()}`,
        task_id: taskId,
        author_id: authorId,
        body: clean,
        created_at: new Date().toISOString(),
      }
      setComments((prev) => [...prev, temp])

      const { data: row, error: insErr } = await supabase
        .from('comments')
        .insert({ task_id: taskId, author_id: authorId, body: clean })
        .select()
        .single()

      if (insErr) {
        if (alive.current) {
          setComments((prev) => prev.filter((c) => c.id !== temp.id))
          setError(friendlyError(insErr))
        }
        return
      }
      if (!alive.current) return
      setComments((prev) => prev.map((c) => (c.id === temp.id ? (row as Comment) : c)))

      // A comment inserts an activity row via trigger, so pull the timeline
      // again to show it. Cheap: one indexed query on a short table.
      const { data: fresh } = await supabase
        .from('activity')
        .select('*')
        .eq('task_id', taskId)
        .order('created_at', { ascending: false })
      if (alive.current && fresh) setActivity(fresh as Activity[])
    },
    [taskId],
  )

  const deleteComment = useCallback(async (id: string) => {
    const snapshot = comments
    setComments((prev) => prev.filter((c) => c.id !== id))
    const { error: delErr } = await supabase.from('comments').delete().eq('id', id)
    if (delErr && alive.current) {
      setComments(snapshot)
      setError(friendlyError(delErr))
    }
  }, [comments])

  return { comments, activity, loading, error, reload: load, addComment, deleteComment }
}
