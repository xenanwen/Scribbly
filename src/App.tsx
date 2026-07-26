import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Header } from './components/Header'
import { Board } from './components/Board'
import { TaskComposer } from './components/TaskComposer'
import { TaskDetail } from './components/TaskDetail'
import { TeamPanel } from './components/TeamPanel'
import { SharePanel } from './components/SharePanel'
import { HomeScreen } from './components/HomeScreen'
import { FinishUpgrade } from './components/FinishUpgrade'
import { BoardSkeleton, ErrorState, NoticeBar, SetupState } from './components/States'
import { useBoard } from './hooks/useBoard'
import { useBoards } from './hooks/useBoards'
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
import { clearInviteToken, readInviteToken, redeemInvite } from './lib/boards'
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
   re-renders. One direction, so the UI can't disagree with the session.

   The one piece of real URL handling is ?invite=<token>: held until there's a
   session, redeemed, then stripped from the address bar.
   ========================================================================== */

export default function App() {
  const session = useSession(isConfigured)
  const identity = session.identity

  const userId = session.status === 'signedIn' ? (identity?.userId ?? null) : null
  // Don't touch boards while an upgrade is mid-flight — that screen has none.
  const activeUserId = identity && !identity.upgradePending ? userId : null

  const boards = useBoards(activeUserId)
  const { refresh: refreshBoards, select: selectBoard } = boards
  const board = useBoard(boards.activeId)

  /* ---- UI state -------------------------------------------------------- */
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [composerFor, setComposerFor] = useState<Status | null>(null)
  const [teamOpen, setTeamOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  /* ---- Invite handling ------------------------------------------------- */
  const [pendingInvite, setPendingInvite] = useState<string | null>(() => readInviteToken())
  const [joinError, setJoinError] = useState<string | null>(null)
  const [joinedName, setJoinedName] = useState<string | null>(null)

  useEffect(() => {
    if (!pendingInvite || session.status !== 'signedIn' || identity?.upgradePending) return
    let cancelled = false

    void (async () => {
      try {
        const joinedBoardId = await redeemInvite(pendingInvite)
        if (cancelled) return
        const next = await refreshBoards()
        selectBoard(joinedBoardId)
        setJoinedName(next.find((b) => b.id === joinedBoardId)?.name ?? 'the board')
      } catch (err) {
        if (!cancelled) setJoinError(friendlyError(err))
      } finally {
        if (!cancelled) {
          // Strip the token either way: a used or invalid link shouldn't sit in
          // browser history, and a reload shouldn't retry it.
          clearInviteToken()
          setPendingInvite(null)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [pendingInvite, session.status, identity?.upgradePending, refreshBoards, selectBoard])

  /* ---- First board for a brand-new account ----------------------------- */
  /* Guests are seeded at sign-in. A fresh email account has no board at all, so
     give it the same starter content rather than an empty switcher. Attempted
     once per session; a failure just leaves them with the empty state. */
  const seedAttempted = useRef(false)
  useEffect(() => {
    if (!activeUserId || boards.state !== 'ready' || boards.boards.length > 0) return
    if (pendingInvite || seedAttempted.current) return
    seedAttempted.current = true
    void (async () => {
      await seedStarterBoard()
      await refreshBoards()
    })()
  }, [activeUserId, boards.state, boards.boards.length, pendingInvite, refreshBoards])

  const openTask = useMemo(
    () => board.data.tasks.find((t) => t.id === openTaskId) ?? null,
    [board.data.tasks, openTaskId],
  )

  useEffect(() => {
    if (openTaskId && !openTask && board.loadState === 'ready') setOpenTaskId(null)
  }, [openTaskId, openTask, board.loadState])

  // Close per-board overlays when the board changes underneath them.
  useEffect(() => {
    setOpenTaskId(null)
    setComposerFor(null)
    setShareOpen(false)
    setFilters(EMPTY_FILTERS)
  }, [boards.activeId])

  const anyOverlayOpen = Boolean(openTaskId || composerFor || teamOpen || shareOpen)

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

  const asFriendly = (err: unknown): never => {
    throw new Error(friendlyError(err))
  }

  const handleGuest = useCallback(async () => {
    try {
      const { isNew } = await continueAsGuest()
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
    setShareOpen(false)
    setOpenTaskId(null)
    setComposerFor(null)
    setFilters(EMPTY_FILTERS)
    seedAttempted.current = false
    try {
      await signOut()
    } catch (err) {
      setAuthError(friendlyError(err))
    }
  }, [])

  const handleResetGuest = useCallback(async () => {
    setTeamOpen(false)
    setFilters(EMPTY_FILTERS)
    seedAttempted.current = false
    await resetGuestSession()
    try {
      const { isNew } = await continueAsGuest()
      if (isNew) await seedStarterBoard()
    } catch (err) {
      setAuthError(friendlyError(err))
    }
  }, [])

  /** Guests can't create or share boards; send them to the upgrade prompt. */
  const promptUpgrade = useCallback(() => {
    setShareOpen(false)
    setTeamOpen(true)
  }, [])

  /* ---- Screens --------------------------------------------------------- */

  if (!isConfigured) return <SetupState />

  if (session.status === 'booting') return <BootScreen note="opening your notebook…" />

  if (session.status === 'signedOut') {
    return (
      <HomeScreen
        onContinueAsGuest={handleGuest}
        onLogin={handleLogin}
        onSignUp={handleSignUp}
        onResend={handleResend}
        invitePending={Boolean(pendingInvite)}
      />
    )
  }

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

  if (pendingInvite) return <BootScreen note="opening the board you were invited to…" />

  if (boards.state === 'error') {
    return (
      <ErrorState
        message={boards.error ?? 'Could not load your boards.'}
        onRetry={() => void refreshBoards()}
      />
    )
  }

  if (boards.state === 'loading' || (boards.boards.length === 0 && !joinError)) {
    return <BootScreen note="setting up your board…" />
  }

  if (board.loadState === 'error') {
    return (
      <ErrorState
        message={board.loadError ?? 'Could not load this board.'}
        onRetry={() => void board.refresh()}
      />
    )
  }

  if (board.loadState === 'loading') return <BootScreen note="fetching your board…" />

  /* Don't render a board we can't identify. Deriving canWrite from a possibly
     null `active` used to default the whole board to read-only during the brief
     window after a refresh where activeId is set but the board list hasn't
     caught up — which looked exactly like drag-and-drop silently breaking. */
  if (!boards.active) return <BootScreen note="opening your board…" />

  const canWrite = boards.active.role !== 'viewer'

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
          boards={boards.boards}
          activeBoard={boards.active}
          onSelectBoard={selectBoard}
          onCreateBoard={(name) => void boards.create(name)}
          onCreateBoardBlocked={promptUpgrade}
          onOpenShare={() => setShareOpen(true)}
        />

        {joinedName && (
          <NoticeBar
            message={`You've joined ${joinedName}.`}
            onDismiss={() => setJoinedName(null)}
          />
        )}
        {joinError && <NoticeBar message={joinError} onDismiss={() => setJoinError(null)} />}
        {authError && <NoticeBar message={authError} onDismiss={() => setAuthError(null)} />}
        {boards.notice && <NoticeBar message={boards.notice} onDismiss={boards.dismissNotice} />}
        {board.notice && <NoticeBar message={board.notice} onDismiss={board.dismissNotice} />}

        {!canWrite && (
          <div className="viewer-bar">
            You have view-only access to this board. Ask the owner for edit access to make changes.
          </div>
        )}

        <Board
          data={board.data}
          filters={filters}
          onOpenTask={setOpenTaskId}
          onQuickAdd={(status, title) => void board.createTask({ title, status })}
          onOpenComposer={(status) => setComposerFor(status)}
          onClearFilters={() => setFilters(EMPTY_FILTERS)}
          moveTask={board.moveTask}
          rebalanceColumn={board.rebalanceColumn}
          readOnly={!canWrite}
        />

        <footer className="app__foot">
          <span>
            {identity.isGuest ? 'Guest session' : `Signed in as ${identity.email}`} · press{' '}
            <kbd>n</kbd> for a new task, <kbd>/</kbd> to search
          </span>
        </footer>
      </div>

      {composerFor && canWrite && (
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
          readOnly={!canWrite}
        />
      )}

      {teamOpen && (
        <TeamPanel
          members={board.data.members}
          labels={board.data.labels}
          tasks={board.data.tasks}
          access={board.data.access}
          identity={identity}
          onClose={() => setTeamOpen(false)}
          onCreateLabel={(name, color) => void board.createLabel(name, color)}
          onDeleteLabel={(id) => void board.deleteLabel(id)}
          onResetSession={() => void handleResetGuest()}
          onStartUpgrade={handleStartUpgrade}
          onSignOut={() => void handleSignOut()}
          onOpenShare={() => {
            setTeamOpen(false)
            setShareOpen(true)
          }}
        />
      )}

      {shareOpen && boards.active && (
        <SharePanel
          board={boards.active}
          members={board.data.members}
          currentUserId={identity.userId}
          isGuest={identity.isGuest}
          onClose={() => setShareOpen(false)}
          onRename={(name) => void boards.rename(boards.active!.id, name)}
          onDelete={() => {
            setShareOpen(false)
            void boards.remove(boards.active!.id)
          }}
          onLeave={() => {
            setShareOpen(false)
            void boards.leave(boards.active!.id, identity.userId)
          }}
          onUpgradePrompt={promptUpgrade}
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
