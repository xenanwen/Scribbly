import { useState } from 'react'
import { Popover } from './Popover'
import { PlusIcon } from './Primitives'
import type { Board } from '../lib/types'

/* ==========================================================================
   Which board am I looking at, and what else can I reach.

   Boards you own and boards you were invited to are separated, because "whose
   board is this" is the first thing you want to know when work is shared.
   ========================================================================== */

interface Props {
  boards: Board[]
  active: Board | null
  onSelect: (boardId: string) => void
  onCreate: (name: string) => void
  canCreate: boolean
  onCreateBlocked: () => void
}

export function BoardSwitcher({
  boards,
  active,
  onSelect,
  onCreate,
  canCreate,
  onCreateBlocked,
}: Props) {
  const mine = boards.filter((b) => b.role === 'owner')
  const shared = boards.filter((b) => b.role !== 'owner')

  return (
    <Popover
      label={
        <span className="switcher__label">
          <span className="switcher__name">{active?.name ?? 'Board'}</span>
          {active && active.role !== 'owner' && (
            <span className="switcher__role">{active.role}</span>
          )}
        </span>
      }
    >
      {(close) => (
        <div className="menu switcher__menu">
          {mine.length > 0 && (
            <>
              <p className="switcher__group">Your boards</p>
              {mine.map((b) => (
                <BoardRow
                  key={b.id}
                  board={b}
                  active={b.id === active?.id}
                  onSelect={() => {
                    onSelect(b.id)
                    close()
                  }}
                />
              ))}
            </>
          )}

          {shared.length > 0 && (
            <>
              <p className="switcher__group">Shared with you</p>
              {shared.map((b) => (
                <BoardRow
                  key={b.id}
                  board={b}
                  active={b.id === active?.id}
                  onSelect={() => {
                    onSelect(b.id)
                    close()
                  }}
                />
              ))}
            </>
          )}

          <NewBoardRow
            canCreate={canCreate}
            onCreate={(name) => {
              onCreate(name)
              close()
            }}
            onBlocked={() => {
              onCreateBlocked()
              close()
            }}
          />
        </div>
      )}
    </Popover>
  )
}

function BoardRow({
  board,
  active,
  onSelect,
}: {
  board: Board
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      className={`switcher__item${active ? ' is-on' : ''}`}
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
    >
      <span className="switcher__tick" aria-hidden="true">
        {active ? '✓' : ''}
      </span>
      <span className="switcher__itemName">{board.name}</span>
      {board.role !== 'owner' && <span className="switcher__role">{board.role}</span>}
    </button>
  )
}

function NewBoardRow({
  canCreate,
  onCreate,
  onBlocked,
}: {
  canCreate: boolean
  onCreate: (name: string) => void
  onBlocked: () => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  if (!open) {
    return (
      <button
        className="switcher__new"
        onClick={() => (canCreate ? setOpen(true) : onBlocked())}
      >
        <PlusIcon />
        New board
      </button>
    )
  }

  return (
    <form
      className="switcher__form"
      onSubmit={(e) => {
        e.preventDefault()
        const clean = name.trim()
        if (clean) onCreate(clean)
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the row only renders
          in response to a click, so focus is expected here. */}
      <input
        className="input input--sm"
        value={name}
        autoFocus
        maxLength={80}
        placeholder="Board name"
        aria-label="New board name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      />
      <button className="quickadd__save" type="submit" disabled={!name.trim()}>
        Add
      </button>
    </form>
  )
}
