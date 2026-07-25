import { useCallback, useEffect, useMemo, useState } from 'react'
import { Header } from './components/Header'
import { Board } from './components/Board'
import { TaskComposer } from './components/TaskComposer'
import { TaskDetail } from './components/TaskDetail'
import { TeamPanel } from './components/TeamPanel'
import { BoardSkeleton, ErrorState, NoticeBar, SetupState } from './components/States'
import { useBoard } from './hooks/useBoard'
import { ensureGuestSession, resetGuestSession, seedStarterBoard } from './lib/auth'
import { friendlyError, isConfigured } from './lib/supabase'
import { EMPTY_FILTERS } from './lib/types'
import type { Filters, Status } from './lib/types'

/* ==========================================================================
   App shell: guest session, then the board, then the overlays.
   ========================================================================== */

type Auth =
  | { state: 'loading' }
  | { state: 'ready'; userId: string }
  | { state: 'error'; message: string }

export default function App() {
  const [auth, setAuth] = useState<Auth>({ state: 'loading' })

  /* ---- Guest session --------------------------------------------------- */
  const startSession = useCallback(async () => {
    setAuth({ state: 'loading' })
    try {
      const { userId, isNew } = await ensureGuestSession()
      // A brand-new visitor gets a small starter board so the first screen
      // demonstrates the interaction instead of showing four empty columns.
      if (isNew) await seedStarterBoard()
      setAuth({ state: 'ready', userId })
    } catch (err) {
      setAuth({ state: 'error', message: friendlyError(err) })
    }
  }, [])

  useEffect(() => {
    if (isConfigured) void startSession()
  }, [startSession])

  const userId = auth.state === 'ready' ? auth.userId : null
  const board = useBoard(userId)

  /* ---- UI state -------------------------------------------------------- */
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [composerFor, setComposerFor] = useState<Status | null>(null)
  const [teamOpen, setTeamOpen] = useState(false)

  const openTask = useMemo(
    () => board.data.tasks.find((t) => t.id === openTaskId) ?? null,
    [board.data.tasks, openTaskId],
  )

  // If the open task disappears (deleted here or in another tab), close cleanly
  // rather than leaving an empty panel on screen.
  useEffect(() => {
    if (openTaskId && !openTask && board.loadState === 'ready') setOpenTaskId(null)
  }, [openTaskId, openTask, board.loadState])

  const anyOverlayOpen = Boolean(openTaskId || composerFor || teamOpen)

  /* ---- Keyboard shortcuts ---------------------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (anyOverlayOpen) return
      const el = e.target as HTMLElement | null
      const typing =
        el &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === 'n') {
        e.preventDefault()
        setComposerFor('todo')
      }
      if (e.key === '/') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('.search__input')?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [anyOverlayOpen])

  const handleReset = async () => {
    await resetGuestSession()
    setTeamOpen(false)
    setFilters(EMPTY_FILTERS)
    window.location.reload()
  }

  /* ---- Gates ----------------------------------------------------------- */

  if (!isConfigured) return <SetupState />

  if (auth.state === 'error') {
    return <ErrorState message={auth.message} onRetry={() => void startSession()} />
  }

  if (auth.state === 'loading' || board.loadState === 'loading') {
    return (
      <div className="app">
        <div className="app__inner">
          <div className="masthead masthead--ghost">
            <div className="masthead__row">
              <div className="masthead__brand">
                <h1 className="masthead__title">Paperboard</h1>
                <p className="masthead__note">setting up your guest board…</p>
              </div>
            </div>
          </div>
          <BoardSkeleton />
        </div>
      </div>
    )
  }

  if (board.loadState === 'error') {
    return (
      <ErrorState
        message={board.loadError ?? 'Could not load your board.'}
        onRetry={() => void board.refresh()}
      />
    )
  }

  /* ---- Board ----------------------------------------------------------- */

  return (
    <div className="app">
      <div className="app__inner">
        <Header
          tasks={board.data.tasks}
          members={board.data.members}
          labels={board.data.labels}
          filters={filters}
          setFilters={setFilters}
          onNewTask={() => setComposerFor('todo')}
          onOpenTeam={() => setTeamOpen(true)}
          syncing={board.syncing}
        />

        {board.notice && <NoticeBar message={board.notice} onDismiss={board.dismissNotice} />}

        <Board
          data={board.data}
          filters={filters}
          onOpenTask={setOpenTaskId}
          onQuickAdd={(status, title) => void board.createTask({ title, status })}
          onOpenComposer={(status) => setComposerFor(status)}
          onClearFilters={() => setFilters(EMPTY_FILTERS)}
          moveTask={board.moveTask}
          rebalanceColumn={board.rebalanceColumn}
        />

        <footer className="app__foot">
          <span>
            Signed in as a guest · press <kbd>n</kbd> for a new task, <kbd>/</kbd> to search
          </span>
        </footer>
      </div>

      {composerFor && (
        <TaskComposer
          initialStatus={composerFor}
          members={board.data.members}
          labels={board.data.labels}
          onClose={() => setComposerFor(null)}
          onCreate={(input) => void board.createTask(input)}
        />
      )}

      {openTask && (
        <TaskDetail
          task={openTask}
          members={board.data.members}
          labels={board.data.labels}
          onClose={() => setOpenTaskId(null)}
          onUpdate={(id, patch) => void board.updateTask(id, patch)}
          onDelete={(id) => void board.deleteTask(id)}
          onSetAssignees={(id, ids) => void board.setAssignees(id, ids)}
          onSetLabels={(id, ids) => void board.setLabels(id, ids)}
        />
      )}

      {teamOpen && auth.state === 'ready' && (
        <TeamPanel
          members={board.data.members}
          labels={board.data.labels}
          tasks={board.data.tasks}
          userId={auth.userId}
          onClose={() => setTeamOpen(false)}
          onCreateMember={(name, color) => void board.createMember(name, color)}
          onDeleteMember={(id) => void board.deleteMember(id)}
          onCreateLabel={(name, color) => void board.createLabel(name, color)}
          onDeleteLabel={(id) => void board.deleteLabel(id)}
          onResetSession={() => void handleReset()}
        />
      )}
    </div>
  )
}
