
# Task-Board-Project

# Paperboard

A Kanban board themed by a paper notebook. Four columns, drag-and-drop between them, guest accounts with no sign-up, and everything persisted in Supabase behind Row Level Security.

**Live demo:** _Vercel URL will be here after deploying_

<!-- Will take a screenshot of the board once it's running, save it as docs/screenshot.png,
     and uncomment the line below. Look at README first.
![Paperboard: four columns on a cream ruled-paper background](docs/screenshot.png)
-->


---

## Quick start

```zsh
git clone https://github.com/<you>/paperboard.git
cd paperboard
npm install
cp .env.local.example .env.local   # then fill in the two values (see below)
npm run dev                        # http://localhost:5173
```

If `.env.local` is missing or incomplete the app renders a setup screen with these
same instructions instead of a blank page.

### Supabase setup (5 minutes)

1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query** → paste all of [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
   It's idempotent, so re-running it is safe.
3. **Authentication → Sign In / Providers →** enable **Anonymous sign-ins**.
   Without this the app cannot create guest sessions.
4. **Project Settings → API** → copy the **Project URL** and the **anon public** key into `.env.local`:

   ```
   VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
   ```

5. `npm run dev`.

> **Never** put the `service_role` key in `.env.local` or anywhere in `src/`. It bypasses
> Row Level Security, and anything prefixed `VITE_` is compiled into the public JS bundle.
> `src/lib/supabase.ts` throws at startup if it detects one.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Typecheck, then production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | 77 assertions over the ordering maths, filters and date logic |
| `npm run check` | typecheck + tests + build — run this before pushing |

---

## How it works

```
src/
├── lib/
│   ├── supabase.ts     Client + friendly error translation
│   ├── auth.ts         Anonymous guest sessions (StrictMode-safe)
│   ├── board.ts        Pure logic: ordering, filtering, urgency, stats
│   └── types.ts        Domain types, mirroring the SQL schema
├── hooks/
│   ├── useBoard.ts     All reads/writes, optimistic updates, realtime
│   └── useTaskThread.ts  Comments + activity for one task (lazy)
├── components/
│   ├── Board.tsx       Drag-and-drop orchestration
│   ├── Column.tsx      One section + inline quick-add
│   ├── TaskCard.tsx    Card, with pointer/keyboard drag split
│   ├── TaskDetail.tsx  Detail drawer: fields, comments, timeline
│   ├── TaskComposer.tsx  Full new-task form
│   ├── TeamPanel.tsx   Members, labels, guest-session info
│   ├── Header.tsx      Stats ledger, search, filters
│   ├── States.tsx      Loading / empty / error screens
│   └── Overlay.tsx     Modal + Drawer shells (focus trap, Escape)
└── styles/
    ├── tokens.css      Every colour, size and duration
    ├── base.css        Reset + the ruled-paper background
    ├── layout.css      Shell, masthead, board, columns
    ├── cards.css       Cards, chips, avatars, badges, skeletons
    └── ui.css          Controls, overlays, timeline
```

### Data flow

The frontend talks to Supabase directly — there is no API server. Every mutation
is **optimistic**: React state updates first, the request goes out, and on failure the
exact pre-change snapshot is restored and a dismissible message appears. That is what
makes dragging feel instant.

A Postgres change feed filtered to `user_id=eq.<guest>` keeps other tabs in sync.
Realtime events trigger a debounced refetch, suppressed while our own writes are in
flight so they can't clobber an optimistic update mid-request.

### Card ordering: fractional indexing

Each task has a `position` float. Dropping a card between two others stores the
**midpoint** of their positions, so a drag writes exactly one row instead of
renumbering every card below it.

Floats run out of precision after ~50 consecutive splits between the same pair, so
`needsRebalance()` watches the gap and renumbers that column onto clean integers
before it becomes a problem. `npm test` asserts the guard fires with a >10-split
margin before positions could collide.

### Drag-and-drop

Built on [dnd-kit](https://dndkit.com). The subtle part is that a cross-column drag
has two phases:

- **`onDragOver`** writes a *draft* task list where the card already belongs to the
  new column at the hovered index, so the other cards part to make room.
- **`onDragEnd`** commits that draft's status and position verbatim.

Committing the draft rather than recomputing from the `over` element matters: the
draft has already inserted the card, which shifts every index the `over` element
reports, and recomputing lands the card one slot below its own preview. Same-column
reordering takes no draft at all — dnd-kit's sortable strategy handles the live
transforms, and the final index is derived with `arrayMove` on drop.

Pointer drag works from anywhere on a card. Keyboard drag works from the grip button
(Tab to it, Space, then arrows), which is kept separate so <kbd>Enter</kbd> can open
the task instead of starting a drag. Screen-reader announcements name the column and
the neighbouring card.

---

## Database

Seven tables, all with RLS enabled and forced. Full DDL in
[`supabase/schema.sql`](supabase/schema.sql).

| Table | Purpose |
| --- | --- |
| `tasks` | id, title, description, status, priority, due_date, position, timestamps |
| `members` | Lightweight team members (name + colour) — not auth users |
| `labels` | User-defined tags with colours |
| `task_assignees` | Task ↔ member, many-to-many |
| `task_labels` | Task ↔ label, many-to-many |
| `comments` | Thread on a task, optional member as author |
| `activity` | Append-only history, written by triggers |

`status` and `priority` are `text` with `CHECK` constraints rather than Postgres enums —
same safety, but adding a value later is a one-line migration instead of `ALTER TYPE`.

The brief suggests a single `assignee_id` column; `task_assignees` is a superset of
that and satisfies the "assign one or more team members" bonus feature.

### Security model

- Every table has `user_id uuid NOT NULL DEFAULT auth.uid()`. The client never chooses
  whose row it is writing — the database fills it in.
- One policy per table: `USING (user_id = (select auth.uid()))` **and**
  `WITH CHECK (...)`. Both are required; `USING` alone would let you rewrite a row's
  `user_id` and hand it to someone else.
- Child tables (`comments`, `task_assignees`, `task_labels`) additionally require
  `owns_task(task_id)`, so a crafted request can't attach a comment to a stranger's
  task while still setting its own `user_id`.
- `activity` has **no** UPDATE or DELETE policy — history can't be rewritten through
  the API. Cascading deletes still clean up, because cascades run outside RLS.
- `(select auth.uid())` rather than bare `auth.uid()` so Postgres evaluates it once per
  statement instead of once per row.
- Activity rows are written by `SECURITY DEFINER` triggers, so the log can't drift out
  of sync with the data even if the client forgets to write it.

### Verifying isolation

```sql
-- Should return rowsecurity = true for all seven tables.
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;
```

In the app: open the board, note the guest id under **Team → This guest session**, add
some tasks. Open the same URL in a different browser (or a private window) — a new
guest id, an empty board, and no trace of the first session's tasks.

---

## Features

**Required** — four columns, drag between them to change status, create tasks with
title/description/priority/due date, guest sign-in on first launch, RLS, distinct
loading/empty/error states, responsive layout.

**Also built:**

- Team members with colour avatars; multiple assignees per task, stacked on the card
- Task detail drawer with a comment thread
- Activity timeline — "Moved from To Do → In Progress · 2 hours ago", generated by DB triggers
- Custom labels, multiple per task, with board filtering
- Due-date badges that escalate: overdue (red) → today (amber) → within 2 days → later.
  Completed tasks keep the date but drop the alarm colouring
- Search across title and description, plus priority / assignee / label filters
- Header stats: total, done with percentage, overdue
- Keyboard shortcuts: <kbd>n</kbd> new task, <kbd>/</kbd> focus search, <kbd>Esc</kbd> close
- Inline quick-add per column that stays open for adding several in a row

---

## Design

The palette and type come from a physical notebook: cream stock (`#faf6ec`), faint blue
rules every 28px, a red margin line, ink-blue type. Column accents are borrowed from
ballpoint and highlighter colours rather than the usual SaaS blues.

Type is three faces with one job each — **Fraunces** for display, **Inter** for UI,
**Caveat** for handwritten notes and empty states.

The ruled background uses `background-attachment: local`, so the lines scroll with the
content the way lines on a real page do. Columns are sunken and tinted; cards are
raised and lighter — that contrast, not borders, is what separates a section from
the cards inside it. Every colour and duration lives in `tokens.css`; no component
contains a raw hex value.

Responsive: four columns → two at 1080px → one full-width column per screen at 720px,
swiped horizontally with scroll snapping. `prefers-reduced-motion` disables animation.

---

## Deploying to Vercel

```zsh
npm run check      # typecheck + tests + build must pass
git push
```

Then at [vercel.com/new](https://vercel.com/new): import the repo, and Vercel will detect
Vite (`npm run build` → `dist`). Before the first deploy, add both environment
variables under **Settings → Environment Variables**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

They must be set for the Production environment, and a redeploy is needed if you add
them after the first build — Vite inlines env vars at build time, not at runtime.

No Supabase configuration is needed for the deploy: the anon key works from any origin,
and RLS is what protects the data.

---

## Trade-offs

- **No backend.** The brief allows calling Supabase directly, and RLS makes a proxy
  redundant for this data model. A Go API would earn its place once there's work that
  can't be expressed as a policy — scheduled digests, webhooks, third-party calls.
- **Debounced refetch instead of merging realtime payloads.** Merging individual
  `postgres_changes` events into local state is fiddly and easy to get subtly wrong;
  a 400ms refetch is a few extra kilobytes and is always correct.
- **Members are rows, not users.** Real invitations would need email auth, which the
  guest-account requirement rules out.
- **Tests cover logic, not components.** The ordering maths and filters are where the
  real bugs live, and they're pure functions. Component tests would need jsdom plus a
  testing library for comparatively little return here.
- **One bundle, no code splitting.** ~110 kB gzipped for a single-screen app; splitting
  would add complexity for no perceptible gain.

---

## Licence

MIT
>>>>>>> 7a3c458 (Paperboard: notebook-styled Kanban board on Supabase)
