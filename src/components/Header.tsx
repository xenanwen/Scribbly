import { CheckRow, Popover } from './Popover'
import { BoardSwitcher } from './BoardSwitcher'
import { Avatar, PlusIcon, PriorityMark, SearchIcon } from './Primitives'
import { PRIORITY_LABEL, computeStats } from '../lib/board'
import { PRIORITIES } from '../lib/types'
import type { Identity } from '../lib/auth'
import type { Board, Filters, Label, Member, Priority, Task } from '../lib/types'

/* ==========================================================================
   Masthead: identity, the summary stats, search and filters.

   Laid out like the top of a notebook page — title in the display serif, a
   handwritten note underneath, and the stats set as a "ledger" of three
   figures separated by hairlines.
   ========================================================================== */

interface Props {
  tasks: Task[]
  members: Member[]
  labels: Label[]
  filters: Filters
  setFilters: (next: Filters) => void
  onNewTask: () => void
  onOpenTeam: () => void
  syncing: boolean
  identity: Identity
  boards: Board[]
  activeBoard: Board | null
  onSelectBoard: (boardId: string) => void
  onCreateBoard: (name: string) => void
  onCreateBoardBlocked: () => void
  onOpenShare: () => void
}

export function Header({
  tasks,
  members,
  labels,
  filters,
  setFilters,
  onNewTask,
  onOpenTeam,
  syncing,
  identity,
  boards,
  activeBoard,
  onSelectBoard,
  onCreateBoard,
  onCreateBoardBlocked,
  onOpenShare,
}: Props) {
  const stats = computeStats(tasks)

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value]

  return (
    <header className="masthead">
      <div className="masthead__row">
        <div className="masthead__brand">
          <h1 className="masthead__title">Scribbly</h1>
          <p className="masthead__note">
            everything you owe the week, on one page
            {syncing && <span className="masthead__sync"> · saving…</span>}
          </p>
        </div>

        <div className="ledger" aria-label="Board summary">
          <Figure value={stats.total} label={stats.total === 1 ? 'task' : 'tasks'} />
          <Figure value={stats.done} label="done" tone="ok" />
          <Figure
            value={stats.overdue}
            label="overdue"
            tone={stats.overdue > 0 ? 'danger' : 'muted'}
          />
        </div>
      </div>

      <div className="toolbar">
        <BoardSwitcher
          boards={boards}
          active={activeBoard}
          onSelect={onSelectBoard}
          onCreate={onCreateBoard}
          canCreate={!identity.isGuest}
          onCreateBlocked={onCreateBoardBlocked}
        />

        <div className="search">
          <span className="search__icon">
            <SearchIcon />
          </span>
          <input
            className="search__input"
            type="search"
            value={filters.query}
            placeholder="Search tasks…"
            aria-label="Search tasks by title or description"
            onChange={(e) => setFilters({ ...filters, query: e.target.value })}
          />
          {filters.query && (
            <button
              className="search__clear"
              onClick={() => setFilters({ ...filters, query: '' })}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        <div className="toolbar__filters">
          <Popover label="Priority" count={filters.priorities.length}>
            {() => (
              <div className="menu">
                {PRIORITIES.map((p: Priority) => (
                  <CheckRow
                    key={p}
                    checked={filters.priorities.includes(p)}
                    onChange={() =>
                      setFilters({ ...filters, priorities: toggle(filters.priorities, p) })
                    }
                  >
                    <span className="menu__row">
                      <PriorityMark priority={p} />
                      {PRIORITY_LABEL[p]}
                    </span>
                  </CheckRow>
                ))}
              </div>
            )}
          </Popover>

          <Popover label="Assignee" count={filters.assigneeIds.length}>
            {() => (
              <div className="menu">
                {members.length === 0 ? (
                  <p className="menu__empty">
                    No team members yet. Add some from the Team panel.
                  </p>
                ) : (
                  members.map((m) => (
                    <CheckRow
                      key={m.id}
                      checked={filters.assigneeIds.includes(m.id)}
                      onChange={() =>
                        setFilters({ ...filters, assigneeIds: toggle(filters.assigneeIds, m.id) })
                      }
                    >
                      <span className="menu__row">
                        <Avatar member={m} size={20} showTooltip={false} />
                        {m.name}
                      </span>
                    </CheckRow>
                  ))
                )}
              </div>
            )}
          </Popover>

          <Popover label="Label" count={filters.labelIds.length}>
            {() => (
              <div className="menu">
                {labels.length === 0 ? (
                  <p className="menu__empty">No labels yet. Create some from the Team panel.</p>
                ) : (
                  labels.map((l) => (
                    <CheckRow
                      key={l.id}
                      checked={filters.labelIds.includes(l.id)}
                      onChange={() =>
                        setFilters({ ...filters, labelIds: toggle(filters.labelIds, l.id) })
                      }
                    >
                      <span className="menu__row">
                        <span className="swatch" style={{ background: l.color }} />
                        {l.name}
                      </span>
                    </CheckRow>
                  ))
                )}
              </div>
            )}
          </Popover>
        </div>

        <div className="toolbar__right">
          {/* Who you are, and for guests the nudge to keep the board. Opens the
              same panel, where the upgrade and sign-out actions live. */}
          <button
            className={`who${identity.isGuest ? ' who--guest' : ''}`}
            onClick={onOpenTeam}
            title={
              identity.isGuest
                ? 'Guest session — tied to this browser. Click to save it to an account.'
                : `Signed in as ${identity.email}`
            }
          >
            <span className="who__dot" aria-hidden="true" />
            <span className="who__text">{identity.isGuest ? 'Guest' : identity.email}</span>
            {identity.isGuest && <span className="who__cta">save&nbsp;board</span>}
          </button>

          {/* The team roster doubles as an affordance: seeing the avatars is what
              tells you assignment exists at all. */}
          <button className="team-btn" onClick={onOpenTeam}>
            <span className="team-btn__stack">
              {members.slice(0, 4).map((m) => (
                <Avatar key={m.id} member={m} size={22} showTooltip={false} />
              ))}
              {members.length === 0 && <span className="team-btn__empty">+</span>}
            </span>
            <span className="team-btn__text">Team</span>
          </button>

          <button className="btn btn--ghost btn--md" onClick={onOpenShare}>
            <ShareIcon />
            Share
          </button>

          <button className="btn btn--primary btn--md" onClick={onNewTask}>
            <PlusIcon />
            New task
          </button>
        </div>
      </div>
    </header>
  )
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <circle cx="12" cy="3.5" r="2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="4" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="12.5" r="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="m5.8 7 4.4-2.4M5.8 9l4.4 2.4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function Figure({
  value,
  label,
  tone = 'default',
}: {
  value: number
  label: string
  tone?: 'default' | 'ok' | 'danger' | 'muted'
}) {
  return (
    <div className={`figure figure--${tone}`}>
      <span className="figure__value">{value}</span>
      <span className="figure__label">{label}</span>
    </div>
  )
}
