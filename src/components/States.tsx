import { Button } from './Primitives'
import { COLUMNS } from '../lib/board'

/* ==========================================================================
   Loading, empty and error states.

   These get their own file because they are the parts of a board app that
   normally get skipped — and they're most of what a first-time visitor sees.
   ========================================================================== */

/** First paint. Mirrors the real column layout so nothing jumps when data
 *  arrives, and each column shows a different number of placeholder cards so
 *  it reads as content rather than as a loading bar. */
export function BoardSkeleton() {
  const counts = [3, 2, 1, 2]
  return (
    <div className="board board--skeleton" aria-hidden="true">
      {COLUMNS.map((col, i) => (
        <section className="column" key={col.status}>
          <header className="column__head">
            <span className="column__rule" style={{ background: col.accent }} />
            <h2 className="column__title">{col.title}</h2>
          </header>
          <div className="column__body">
            {Array.from({ length: counts[i] }).map((_, j) => (
              <div className="skeleton-card" key={j}>
                <div className="shimmer shimmer--title" />
                <div className="shimmer shimmer--meta" />
              </div>
            ))}
          </div>
        </section>
      ))}
      <p className="sr-only" role="status">
        Loading your board…
      </p>
    </div>
  )
}

/** Per-column empty state. Distinguishes "nothing here yet" from "your filters
 *  hid everything", because the fix is completely different. */
export function EmptyColumn({
  status,
  filtered,
  onClear,
  onAdd,
}: {
  status: string
  filtered: boolean
  onClear: () => void
  onAdd: () => void
}) {
  if (filtered) {
    return (
      <div className="empty empty--filtered">
        <p className="empty__text">No matches here.</p>
        <button className="link-btn" onClick={onClear}>
          Clear filters
        </button>
      </div>
    )
  }

  const copy: Record<string, { line: string; sub: string }> = {
    todo: { line: 'Nothing on the list', sub: 'Add the first thing you need to do.' },
    in_progress: { line: 'Nothing in flight', sub: 'Drag a card here when you start it.' },
    in_review: { line: 'Nothing to review', sub: 'Work lands here when it needs a second pair of eyes.' },
    done: { line: 'Nothing finished yet', sub: 'Completed work collects here.' },
  }
  const { line, sub } = copy[status] ?? copy.todo

  return (
    <div className="empty">
      <DoodleClip />
      <p className="empty__text">{line}</p>
      <p className="empty__sub">{sub}</p>
      {status === 'todo' && (
        <button className="link-btn" onClick={onAdd}>
          Add a task
        </button>
      )}
    </div>
  )
}

/** Full-page failure: the initial load didn't work at all. */
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="state-page">
      <div className="state-page__card">
        <DoodleTornPage />
        <h2>That didn't load</h2>
        <p className="state-page__msg">{message}</p>
        <div className="state-page__actions">
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
        </div>
        <p className="state-page__hint">
          If this keeps happening, check that <code>supabase/schema.sql</code> has been run and that
          your <code>.env.local</code> values match your project.
        </p>
      </div>
    </div>
  )
}

/** Shown when the env vars are missing — a much better first run than a blank
 *  screen and a console error. */
export function SetupState() {
  return (
    <div className="state-page">
      <div className="state-page__card state-page__card--wide">
        <h2>Almost there</h2>
        <p className="state-page__msg">
          Scribbly needs your Supabase project details before it can load a board.
        </p>
        <ol className="setup-list">
          <li>
            Copy <code>.env.local.example</code> to <code>.env.local</code>
          </li>
          <li>
            Paste in your <strong>Project URL</strong> and <strong>anon public key</strong> from
            Supabase → Project Settings → API
          </li>
          <li>
            Run <code>supabase/schema.sql</code> in the Supabase SQL editor
          </li>
          <li>
            Enable <strong>Authentication → Sign In / Providers → Anonymous sign-ins</strong>
          </li>
          <li>
            Restart the dev server: <code>npm run dev</code>
          </li>
        </ol>
        <p className="state-page__hint">
          Only the anon key goes in <code>.env.local</code>. The service role key must never leave
          the Supabase dashboard.
        </p>
      </div>
    </div>
  )
}

/** Non-blocking problem strip: a write failed, the board is still usable. */
export function NoticeBar({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="notice" role="alert">
      <span className="notice__dot" />
      <p className="notice__text">{message}</p>
      <button className="notice__x" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}

/* ---- Hand-drawn doodles, to keep empty space feeling like a notebook ----- */

function DoodleClip() {
  return (
    <svg viewBox="0 0 48 48" width="40" height="40" fill="none" className="doodle" aria-hidden="true">
      <path
        d="M17 34V15a5 5 0 0 1 10 0v20a8 8 0 0 1-16 0V19"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function DoodleTornPage() {
  return (
    <svg viewBox="0 0 64 64" width="52" height="52" fill="none" className="doodle" aria-hidden="true">
      <path
        d="M16 8h22l10 10v20l-6 4 6 4v10H16V8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M24 22h16M24 30h16M24 38h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
