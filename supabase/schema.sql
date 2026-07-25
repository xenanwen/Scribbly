-- ============================================================================
-- Paperboard — full database schema
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ENUM-LIKE DOMAINS
-- We use text + CHECK constraints instead of Postgres enums. Enums are rigid
-- (adding a value needs ALTER TYPE and can't run in some transactions);
-- CHECK constraints give the same safety and are easy to evolve.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 2. TABLES
-- ---------------------------------------------------------------------------

-- Team members. These are lightweight records the guest user creates — they are
-- NOT auth users. A member belongs to exactly one guest session.
create table if not exists public.members (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid()
               references auth.users (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  color      text not null default '#d4756b'
               check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now()
);

-- Custom labels, e.g. "Bug", "Feature", "Design".
create table if not exists public.labels (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid()
               references auth.users (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 30),
  color      text not null default '#8a9a6b'
               check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- The core table.
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid()
                references auth.users (id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 5000),
  status      text not null default 'todo'
                check (status in ('todo', 'in_progress', 'in_review', 'done')),
  priority    text not null default 'normal'
                check (priority in ('low', 'normal', 'high')),
  due_date    date,
  -- Fractional index: to place a card between two others we store the midpoint
  -- of their positions. Avoids renumbering every sibling row on each drag.
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Assignees: many-to-many, so a task can have several teammates.
-- (The brief mentions a single assignee_id; a join table is a superset of that
-- and satisfies the "assign one or more team members" bonus feature.)
create table if not exists public.task_assignees (
  task_id   uuid not null references public.tasks (id)   on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  user_id   uuid not null default auth.uid()
              references auth.users (id) on delete cascade,
  primary key (task_id, member_id)
);

-- Labels on tasks: also many-to-many.
create table if not exists public.task_labels (
  task_id  uuid not null references public.tasks (id)  on delete cascade,
  label_id uuid not null references public.labels (id) on delete cascade,
  user_id  uuid not null default auth.uid()
             references auth.users (id) on delete cascade,
  primary key (task_id, label_id)
);

-- Comments on a task, newest last in the UI.
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  user_id    uuid not null default auth.uid()
               references auth.users (id) on delete cascade,
  -- Optional: which teammate is speaking. Set null for "you".
  author_id  uuid references public.members (id) on delete set null,
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

-- Append-only activity log. Written by triggers (below) so it can never drift
-- out of sync with the data, even if the client forgets to log something.
create table if not exists public.activity (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  user_id    uuid not null default auth.uid()
               references auth.users (id) on delete cascade,
  kind       text not null
               check (kind in ('created', 'status', 'edited', 'assigned',
                               'unassigned', 'labeled', 'unlabeled', 'commented')),
  from_value text,
  to_value   text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. INDEXES
-- Every RLS policy filters on user_id, and the board always reads by
-- (user_id, status), so those are the indexes that matter.
-- ---------------------------------------------------------------------------
create index if not exists tasks_user_status_pos_idx
  on public.tasks (user_id, status, position);
create index if not exists tasks_user_due_idx
  on public.tasks (user_id, due_date) where due_date is not null;
create index if not exists members_user_idx        on public.members (user_id);
create index if not exists labels_user_idx         on public.labels (user_id);
create index if not exists task_assignees_task_idx on public.task_assignees (task_id);
create index if not exists task_labels_task_idx    on public.task_labels (task_id);
create index if not exists comments_task_time_idx  on public.comments (task_id, created_at);
create index if not exists activity_task_time_idx  on public.activity (task_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- This is the whole security model. The browser holds only the anon key, so
-- these policies are what stop guest A from touching guest B's rows.
--
--   USING      -> which existing rows you may see / update / delete
--   WITH CHECK -> what the row must look like after an insert / update
--
-- Both are needed: USING alone would let you rewrite a row's user_id and
-- hand it to someone else.
-- ---------------------------------------------------------------------------
alter table public.members        enable row level security;
alter table public.labels         enable row level security;
alter table public.tasks          enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_labels    enable row level security;
alter table public.comments       enable row level security;
alter table public.activity       enable row level security;

-- Defensive: RLS is bypassed for the table owner unless we force it.
alter table public.members        force row level security;
alter table public.labels         force row level security;
alter table public.tasks          force row level security;
alter table public.task_assignees force row level security;
alter table public.task_labels    force row level security;
alter table public.comments       force row level security;
alter table public.activity       force row level security;

-- Helper: does the caller own this task? Used by the child-table policies so a
-- crafted request can't attach a comment to someone else's task id while still
-- setting its own user_id.
--
-- SECURITY INVOKER + STABLE. It reads public.tasks, which is itself protected by
-- RLS, so this cannot be used to probe other users' data.
create or replace function public.owns_task(p_task_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.tasks
    where id = p_task_id and user_id = (select auth.uid())
  );
$$;

-- Note on `(select auth.uid())` rather than bare `auth.uid()`: the subquery form
-- is evaluated once per statement instead of once per row. On a few thousand
-- rows that is a measurable difference.

-- --- Top-level tables: you own the row, full access. --------------------------
drop policy if exists members_owner_all on public.members;
create policy members_owner_all on public.members
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists labels_owner_all on public.labels;
create policy labels_owner_all on public.labels
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists tasks_owner_all on public.tasks;
create policy tasks_owner_all on public.tasks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- --- Child tables: you own the row AND you own the task it points at. --------
drop policy if exists task_assignees_owner_all on public.task_assignees;
create policy task_assignees_owner_all on public.task_assignees
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.owns_task(task_id));

drop policy if exists task_labels_owner_all on public.task_labels;
create policy task_labels_owner_all on public.task_labels
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.owns_task(task_id));

drop policy if exists comments_owner_all on public.comments;
create policy comments_owner_all on public.comments
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.owns_task(task_id));

-- --- Activity: append-only from the client. ----------------------------------
-- No UPDATE or DELETE policy exists, so the history cannot be rewritten through
-- the API. (Cascading deletes from tasks still clean up, because cascades run
-- outside RLS.)
drop policy if exists activity_owner_read on public.activity;
create policy activity_owner_read on public.activity
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists activity_owner_insert on public.activity;
create policy activity_owner_insert on public.activity
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 4b. TABLE-LEVEL GRANTS
--
-- Postgres access control has two independent layers and a statement must pass
-- BOTH:
--
--   1. GRANT — may this role touch this table at all?
--   2. RLS   — which rows may it touch?
--
-- Policies alone are not enough. Without a GRANT, PostgREST fails with
--   42501  permission denied for table tasks
-- before any policy is consulted. Supabase's default privileges normally cover
-- new tables in `public`, but that depends on which role ran the DDL, so grant
-- explicitly rather than relying on it.
--
-- `authenticated` gets full DML; RLS is what narrows it to its own rows.
-- `anon` deliberately gets nothing: a caller holding only the publishable key
-- and no session should not be able to read a single row. Guests call
-- signInAnonymously() first, which upgrades them to `authenticated`.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on
  public.members,
  public.labels,
  public.tasks,
  public.task_assignees,
  public.task_labels,
  public.comments
  to authenticated;

-- activity is append-only, matching its policies: no update, no delete.
grant select, insert on public.activity to authenticated;

-- Belt and braces: make sure the unauthenticated role has no reach into the
-- data, even if a default privilege granted it something earlier.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- 5. TRIGGERS
-- ---------------------------------------------------------------------------

-- 5a. Keep updated_at honest.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists tasks_touch_updated_at on public.tasks;
create trigger tasks_touch_updated_at
  before update on public.tasks
  for each row execute function public.touch_updated_at();

-- 5b. Activity log. SECURITY DEFINER so the insert into activity can't be
-- blocked by RLS mid-transaction; we set user_id from the task row itself
-- rather than trusting the caller.
create or replace function public.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity (task_id, user_id, kind, to_value)
    values (new.id, new.user_id, 'created', new.title);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.activity (task_id, user_id, kind, from_value, to_value)
    values (new.id, new.user_id, 'status', old.status, new.status);
  end if;

  if new.title    is distinct from old.title
  or new.priority is distinct from old.priority
  or new.due_date is distinct from old.due_date
  or new.description is distinct from old.description then
    insert into public.activity (task_id, user_id, kind, from_value, to_value)
    values (
      new.id, new.user_id, 'edited',
      case
        when new.title    is distinct from old.title    then 'title'
        when new.priority is distinct from old.priority then 'priority'
        when new.due_date is distinct from old.due_date then 'due date'
        else 'description'
      end,
      new.title
    );
  end if;

  return new;
end $$;

drop trigger if exists tasks_activity_ins on public.tasks;
create trigger tasks_activity_ins
  after insert on public.tasks
  for each row execute function public.log_task_activity();

drop trigger if exists tasks_activity_upd on public.tasks;
create trigger tasks_activity_upd
  after update on public.tasks
  for each row execute function public.log_task_activity();

-- 5c. Assignment + label + comment activity.
create or replace function public.log_link_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind  text;
  v_label text;
  v_task  uuid;
  v_user  uuid;
begin
  if tg_table_name = 'task_assignees' then
    v_task := coalesce(new.task_id, old.task_id);
    v_kind := case when tg_op = 'INSERT' then 'assigned' else 'unassigned' end;
    select name into v_label from public.members
      where id = coalesce(new.member_id, old.member_id);
  elsif tg_table_name = 'task_labels' then
    v_task := coalesce(new.task_id, old.task_id);
    v_kind := case when tg_op = 'INSERT' then 'labeled' else 'unlabeled' end;
    select name into v_label from public.labels
      where id = coalesce(new.label_id, old.label_id);
  else -- comments
    v_task := new.task_id;
    v_kind := 'commented';
    v_label := left(new.body, 80);
  end if;

  select user_id into v_user from public.tasks where id = v_task;
  if v_user is null then
    return coalesce(new, old);
  end if;

  insert into public.activity (task_id, user_id, kind, to_value)
  values (v_task, v_user, v_kind, v_label);

  return coalesce(new, old);
end $$;

drop trigger if exists task_assignees_activity on public.task_assignees;
create trigger task_assignees_activity
  after insert or delete on public.task_assignees
  for each row execute function public.log_link_activity();

drop trigger if exists task_labels_activity on public.task_labels;
create trigger task_labels_activity
  after insert or delete on public.task_labels
  for each row execute function public.log_link_activity();

drop trigger if exists comments_activity on public.comments;
create trigger comments_activity
  after insert on public.comments
  for each row execute function public.log_link_activity();

-- ---------------------------------------------------------------------------
-- 6. REALTIME
-- Lets the board react to changes from another tab / device on the same guest
-- session. RLS still applies to realtime, so no cross-user leakage.
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.tasks;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 7. STARTER CONTENT
-- Called once, by the client, right after a guest session is created. Gives a
-- brand-new visitor a board with something on it instead of four empty columns.
-- SECURITY DEFINER + a hard guard: it refuses to run if the caller already
-- has tasks, and it only ever writes rows owned by the caller.
-- ---------------------------------------------------------------------------
create or replace function public.seed_starter_board()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_me        uuid;
  v_design    uuid;
  v_bug       uuid;
  v_feature   uuid;
  v_task      uuid;
begin
  if v_uid is null then
    raise exception 'seed_starter_board must be called by a signed-in user';
  end if;

  -- Idempotent: never seed twice.
  if exists (select 1 from public.tasks where user_id = v_uid) then
    return;
  end if;

  insert into public.members (user_id, name, color)
  values (v_uid, 'You', '#d4756b')
  returning id into v_me;

  insert into public.members (user_id, name, color)
  values (v_uid, 'Sam Ito',   '#5b7c99'),
         (v_uid, 'Ada Reyes', '#8a9a6b');

  insert into public.labels (user_id, name, color)
  values (v_uid, 'Design', '#9b7fb5') returning id into v_design;
  insert into public.labels (user_id, name, color)
  values (v_uid, 'Bug', '#c1544a') returning id into v_bug;
  insert into public.labels (user_id, name, color)
  values (v_uid, 'Feature', '#4f8a6b') returning id into v_feature;

  insert into public.tasks (user_id, title, description, status, priority, due_date, position)
  values (v_uid,
          'Welcome to Paperboard',
          E'Drag this card into another column to see the status update stick.\n\nClick it to open the detail panel — comments and an activity log live in there.',
          'todo', 'normal', current_date + 3, 1000)
  returning id into v_task;
  insert into public.task_assignees (user_id, task_id, member_id) values (v_uid, v_task, v_me);
  insert into public.task_labels (user_id, task_id, label_id) values (v_uid, v_task, v_feature);

  insert into public.tasks (user_id, title, description, status, priority, due_date, position)
  values (v_uid, 'Sketch the empty-state illustration', null, 'todo', 'low', null, 2000)
  returning id into v_task;
  insert into public.task_labels (user_id, task_id, label_id) values (v_uid, v_task, v_design);

  insert into public.tasks (user_id, title, description, status, priority, due_date, position)
  values (v_uid, 'Ruled-paper background misaligns on Safari', null,
          'in_progress', 'high', current_date - 1, 1000)
  returning id into v_task;
  insert into public.task_labels (user_id, task_id, label_id) values (v_uid, v_task, v_bug);

  insert into public.tasks (user_id, title, description, status, priority, due_date, position)
  values (v_uid, 'Row Level Security policies', null, 'in_review', 'high', current_date, 1000)
  returning id into v_task;

  insert into public.tasks (user_id, title, description, status, priority, due_date, position)
  values (v_uid, 'Pick a typeface pairing', null, 'done', 'normal', null, 1000);
end $$;

revoke all on function public.seed_starter_board() from public, anon;
grant execute on function public.seed_starter_board() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. VERIFY
-- After running, this should show rowsecurity = true for all seven tables.
-- ---------------------------------------------------------------------------
-- select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' order by tablename;
