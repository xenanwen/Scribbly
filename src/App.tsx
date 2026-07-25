import { useCallback, useEffect, useMemo, useState } from 'react'
import { Header } from './components/Header'
import { Board } from './components/Board'
import { TaskComposer } from './components/TaskComposer'
import { TaskDetail } from './components/TaskDetail'
import { TeamPanel } from './components/TeamPanel'
import { HomeScreen } from './components/HomeScreen'
import { FinishUpgrade } from './components/FinishUpgrade'
import { BoardSkeleton, ErrorState, NoticeBar, SetupState } from './components/States'
import { useBoard } from './hooks/useBoard'
import { useSession } from './hooks/useSession'
import {
  cancelUpgrade,
  continueAsGuest,
  finishUpgrade,
  resendConfirmation,
  resetGuestSession,
  seedStarterBoard,
  signIn,
  signOut,
  signUp,
  startUpgrade,
} from './lib/auth'
import { friendlyError, isConfigured } from './lib/supabase'
import { EMPTY_FILTERS } from './lib/types'
import type { Filters, Status } from './lib/types'

/* ==========================================================================
   App shell.

   Routing is a state machine over the session rather than a router, because
   there are only ever four screens:

     booting        → skeleton
     signedOut      → HomeScreen (log in / sign up / guest)
     upgradePending → FinishUpgrade (email confirmed, password still to set)
     signedIn       → the board

   Nothing here reads or writes auth state directly. Forms call into lib/auth,
   Supabase emits an auth event, useSession picks it up, and this component
   re-renders. One direction, no chance of the UI and the session disagreeing.
   ========================================================================== */

export default function App() {
  const session = useSession(isConfigured)
  const identity = session.identity

  const userId = session.status === 'signedIn' ? (identity?.userId ?? null) : null
  // Don't start loading the board while an upgrade is mid-flight — that screen
  // has no board on it.
  const boardUserId = identity && !identity.upgradePending ? userId : null
  const board = useBoard(boardUserId)

  /* ---- UI state -------------------------------------------------------- */
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [composerFor, setComposerFor] = useState<Status | null>(null)
  const [teamOpen, setTeamOpen] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

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
    if (session.status !== 'signedIn') return
    const onKey = (e: KeyboardEvent) => {
      if (anyOverlayOpen) return
      const el = e.target as HTMLElement | null
      const typing =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
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
  }, [anyOverlayOpen, session.status])

  /* ---- Auth actions ---------------------------------------------------- */

  /* Errors are re-thrown after translation: HomeScreen renders them next to the
     form that caused them, which is where the user is looking. */
  const asFriendly = (err: unknown): never => {
    throw new Error(friendlyError(err))
  }

  const handleGuest = useCallback(async () => {
    try {
      const { isNew } = await continueAsGuest()
      // A brand-new visitor gets a small starter board, so the first screen
      // demonstrates the interaction instead of showing four empty columns.
      if (isNew) await seedStarterBoard()
    } catch (err) {
      asFriendly(err)
    }
  }, [])

  const handleLogin = useCallback(async (email: string, password: string) => {
    try {
      await signIn(email, password)
    } catch (err) {
      asFriendly(err)
    }
  }, [])

  const handleSignUp = useCallback(async (email: string, password: string) => {
    try {
      return await signUp(email, password)
    } catch (err) {
      return asFriendly(err)
    }
  }, [])

  const handleResend = useCallback(async (email: string) => {
    try {
      await resendConfirmation(email)
    } catch (err) {
      asFriendly(err)
    }
  }, [])

  const handleStartUpgrade = useCallback(async (email: string) => {
    try {
      await startUpgrade(email)
    } catch (err) {
      asFriendly(err)
    }
  }, [])

  const handleFinishUpgrade = useCallback(async (password: string) => {
    try {
      await finishUpgrade(password)
    } catch (err) {
      asFriendly(err)
    }
  }, [])

  const handleCancelUpgrade = useCallback(async () => {
    try {
      await cancelUpgrade()
    } catch (err) {
      asFriendly(err)
    }
  }, [])

  const handleSignOut = useCallback(async () => {
    setTeamOpen(false)
    setOpenTaskId(null)
    setComposerFor(null)
    setFilters(EMPTY_FILTERS)
    try {
      await signOut()
    } catch (err) {
      setAuthError(friendlyError(err))
    }
  }, [])

  const handleResetGuest = useCallback(async () => {
    setTeamOpen(false)
    setFilters(EMPTY_FILTERS)
    await resetGuestSession()
    // Straight back into a fresh guest board rather than out to the home screen.
    try {
      const { isNew } = await continueAsGuest()
      if (isNew) await seedStarterBoard()
    } catch (err) {
      setAuthError(friendlyError(err))
    }
  }, [])

  /* ---- Screens --------------------------------------------------------- */

  if (!isConfigured) return <SetupState />

  if (session.status === 'booting') {
    return <BootScreen note="opening your notebook…" />
  }

  if (session.status === 'signedOut') {
    return (
      <HomeScreen
        onContinueAsGuest={handleGuest}
        onLogin={handleLogin}
        onSignUp={handleSignUp}
        onResend={handleResend}
      />
    )
  }

  // Email confirmed, password not set yet.
  if (identity?.upgradePending && identity.email) {
    return (
      <FinishUpgrade
        email={identity.email}
        onFinish={handleFinishUpgrade}
        onCancel={handleCancelUpgrade}
      />
    )
  }

  if (!identity) return <BootScreen note="opening your notebook…" />

  if (board.loadState === 'loading') {
    return <BootScreen note="fetching your board…" />
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
          identity={identity}
        />

        {authError && <NoticeBar message={authError} onDismiss={() => setAuthError(null)} />}
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
            {identity.isGuest ? 'Guest session' : `Signed in as ${identity.email}`} · press{' '}
            <kbd>n</kbd> for a new task, <kbd>/</kbd> to search
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

      {teamOpen && (
        <TeamPanel
          members={board.data.members}
          labels={board.data.labels}
          tasks={board.data.tasks}
          identity={identity}
          onClose={() => setTeamOpen(false)}
          onCreateMember={(name, color) => void board.createMember(name, color)}
          onDeleteMember={(id) => void board.deleteMember(id)}
          onCreateLabel={(name, color) => void board.createLabel(name, color)}
          onDeleteLabel={(id) => void board.deleteLabel(id)}
          onResetSession={() => void handleResetGuest()}
          onStartUpgrade={handleStartUpgrade}
          onSignOut={() => void handleSignOut()}
        />
      )}
    </div>
  )
}

/** Shared loading shell so the masthead doesn't pop in and shift the layout. */
function BootScreen({ note }: { note: string }) {
  return (
    <div className="app">
      <div className="app__inner">
        <div className="masthead masthead--ghost">
          <div className="masthead__row">
            <div className="masthead__brand">
              <h1 className="masthead__title">Scribbly</h1>
              <p className="masthead__note">{note}</p>
            </div>
          </div>
        </div>
        <BoardSkeleton />
      </div>
    </div>
  )
}
