-- ============================================================================
-- Scribbly — complete schema, final state
--
-- This is the whole database in one file, as it stands after
-- schema.sql + 002_collaboration.sql + 003_real_members.sql
-- + 004_invite_param_fix.sql + 005_invite_token_fix.sql.
--
-- Use this file to build a FRESH database in one step.
-- Use the numbered migrations to upgrade an EXISTING one, in order.
-- The end state is identical.
--
-- Ten tables. RLS enabled and forced on every one. Access is decided by board
-- membership; `user_id` records authorship, not ownership.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. BOARDS AND ACCESS
-- ---------------------------------------------------------------------------

create table if not exists public.boards (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid()
               references auth.users (id) on delete cascade,
  name       text not null default 'My board'
               check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);

-- The access-control table. Every policy in this schema resolves through it.
create table if not exists public.board_members (
  board_id  uuid not null references public.boards (id) on delete cascade,
  user_id   uuid not null references auth.users (id)    on delete cascade,
  role      text not null default 'editor'
              check (role in ('owner', 'editor', 'viewer')),
  joined_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

-- Secret join links. Tokens are generated server-side by create_board_invite();
-- the client never chooses one.
create table if not exists public.board_invites (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.boards (id) on delete cascade,
  token      text not null unique,
  role       text not null default 'editor' check (role in ('editor', 'viewer')),
  created_by uuid not null default auth.uid()
               references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  max_uses   integer check (max_uses is null or max_uses > 0),
  uses       integer not null default 0
);

-- ---------------------------------------------------------------------------
-- 2. BOARD CONTENT
--
-- Note on the two uuid columns present throughout:
--   board_id — WHICH BOARD this belongs to. Decides who may read or write it.
--   user_id  — WHO CREATED it. Authorship only, so comment and activity
--              attribution stays meaningful once a board is shared.
-- ---------------------------------------------------------------------------

-- Assignable people. Created automatically by a trigger when someone joins a
-- board (section 6), never by hand: auth_user_id is mandatory, so a member row
-- always corresponds to a real account.
create table if not exists public.members (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references public.boards (id) on delete cascade,
  user_id      uuid not null default auth.uid()
                 references auth.users (id) on delete cascade,
  -- Enforced by the CHECK below rather than as a NOT NULL column, because the
  -- column was added nullable by an earlier migration and the constraint came
  -- later. Effect is identical: a member row cannot exist without an account.
  auth_user_id uuid references auth.users (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 60),
  email        text,
  color        text not null default '#d4756b'
                 check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at   timestamptz not null default now(),
  constraint members_must_be_real check (auth_user_id is not null)
);

create table if not exists public.labels (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.boards (id) on delete cascade,
  user_id    uuid not null default auth.uid()
               references auth.users (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 30),
  color      text not null default '#8a9a6b'
               check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  -- Per board, not per user: two members of one board must not each be able to
  -- create their own "Bug".
  unique (board_id, name)
);

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.boards (id) on delete cascade,
  user_id     uuid not null default auth.uid()
                references auth.users (id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (char_length(description) <= 5000),
  status      text not null default 'todo'
                check (status in ('todo', 'in_progress', 'in_review', 'done')),
  priority    text not null default 'normal'
                check (priority in ('low', 'normal', 'high')),
  due_date    date,
  -- Fractional index. To drop a card between two others we store the midpoint
  -- of their positions, so one drag writes one row instead of renumbering every
  -- sibling below it.
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Many-to-many, so a task can have several assignees. (The brief suggests a
-- single assignee_id column; this is a superset of that.)
create table if not exists public.task_assignees (
  task_id   uuid not null references public.tasks (id)   on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  board_id  uuid not null references public.boards (id)  on delete cascade,
  user_id   uuid not null default auth.uid()
              references auth.users (id) on delete cascade,
  primary key (task_id, member_id)
);

create table if not exists public.task_labels (
  task_id  uuid not null references public.tasks (id)  on delete cascade,
  label_id uuid not null references public.labels (id) on delete cascade,
  board_id uuid not null references public.boards (id) on delete cascade,
  user_id  uuid not null default auth.uid()
             references auth.users (id) on delete cascade,
  primary key (task_id, label_id)
);

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id)  on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
  user_id    uuid not null default auth.uid()
               references auth.users (id) on delete cascade,
  -- Which teammate is speaking. SET NULL rather than cascade, so removing a
  -- person never deletes what they wrote.
  author_id  uuid references public.members (id) on delete set null,
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

-- Append-only history, written by triggers so it cannot drift out of step with
-- the data even if the client forgets to log something.
create table if not exists public.activity (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id)  on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
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
-- Every policy filters on board_id, and the board reads by (board_id, status).
-- ---------------------------------------------------------------------------
create index if not exists boards_owner_idx            on public.boards (owner_id);
create index if not exists board_members_user_idx      on public.board_members (user_id);
create index if not exists board_invites_board_idx     on public.board_invites (board_id);
create index if not exists tasks_board_status_pos_idx  on public.tasks (board_id, status, position);
create index if not exists tasks_board_due_idx         on public.tasks (board_id, due_date) where due_date is not null;
create index if not exists members_board_idx           on public.members (board_id);
create index if not exists labels_board_idx            on public.labels (board_id);
create index if not exists task_assignees_task_idx     on public.task_assignees (task_id);
create index if not exists task_labels_task_idx        on public.task_labels (task_id);
create index if not exists comments_task_time_idx      on public.comments (task_id, created_at);
create index if not exists activity_task_time_idx      on public.activity (task_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. MEMBERSHIP HELPERS
--
-- SECURITY DEFINER is required, not a convenience. The policy ON board_members
-- must ask "is the caller a member of this board?", which means reading
-- board_members. Through RLS that re-enters the same policy and Postgres raises
--   infinite recursion detected in policy for relation "board_members"
-- A definer function reads with RLS bypassed and breaks the cycle. Each returns
-- one boolean about the calling user, so nothing is exposed.
-- ---------------------------------------------------------------------------

create or replace function public.is_board_member(p_board uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.board_members
     where board_id = p_board and user_id = (select auth.uid())
  );
$$;

create or replace function public.can_edit_board(p_board uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.board_members
     where board_id = p_board and user_id = (select auth.uid())
       and role in ('owner', 'editor')
  );
$$;

create or replace function public.is_board_owner(p_board uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.board_members
     where board_id = p_board and user_id = (select auth.uid())
       and role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
--
--   USING      → which existing rows you may see, update or delete
--   WITH CHECK → what a row must look like after an insert or update
--
-- Both are needed on updates. USING alone would let you rewrite a row's
-- board_id and move it onto a board you happen to belong to.
--
-- `(select auth.uid())` rather than bare auth.uid(): the subquery form is
-- evaluated once per statement instead of once per row.
-- ---------------------------------------------------------------------------

alter table public.boards         enable row level security;
alter table public.board_members  enable row level security;
alter table public.board_invites  enable row level security;
alter table public.members        enable row level security;
alter table public.labels         enable row level security;
alter table public.tasks          enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_labels    enable row level security;
alter table public.comments       enable row level security;
alter table public.activity       enable row level security;

alter table public.boards         force row level security;
alter table public.board_members  force row level security;
alter table public.board_invites  force row level security;
alter table public.members        force row level security;
alter table public.labels         force row level security;
alter table public.tasks          force row level security;
alter table public.task_assignees force row level security;
alter table public.task_labels    force row level security;
alter table public.comments       force row level security;
alter table public.activity       force row level security;

-- --- boards ----------------------------------------------------------------
drop policy if exists boards_select on public.boards;
create policy boards_select on public.boards for select to authenticated
  using (public.is_board_member(id));

drop policy if exists boards_insert on public.boards;
create policy boards_insert on public.boards for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists boards_update on public.boards;
create policy boards_update on public.boards for update to authenticated
  using (public.is_board_owner(id)) with check (public.is_board_owner(id));

drop policy if exists boards_delete on public.boards;
create policy boards_delete on public.boards for delete to authenticated
  using (public.is_board_owner(id));

-- --- board_members ---------------------------------------------------------
drop policy if exists board_members_select on public.board_members;
create policy board_members_select on public.board_members for select to authenticated
  using (public.is_board_member(board_id));

-- You may add yourself as owner of a board you just created — the only moment
-- you are not yet a member. Every other insert goes through
-- redeem_board_invite(), which is SECURITY DEFINER.
drop policy if exists board_members_insert_self_owner on public.board_members;
create policy board_members_insert_self_owner on public.board_members for insert to authenticated
  with check (
    user_id = (select auth.uid()) and role = 'owner'
    and exists (select 1 from public.boards
                 where id = board_id and owner_id = (select auth.uid()))
  );

drop policy if exists board_members_update on public.board_members;
create policy board_members_update on public.board_members for update to authenticated
  using (public.is_board_owner(board_id)) with check (public.is_board_owner(board_id));

-- Owners may remove anyone; anyone may remove themselves (leave a board).
drop policy if exists board_members_delete on public.board_members;
create policy board_members_delete on public.board_members for delete to authenticated
  using (public.is_board_owner(board_id) or user_id = (select auth.uid()));

-- --- board_invites ---------------------------------------------------------
-- Owners only. Note there is deliberately NO policy letting a non-member read
-- by token: redemption happens in a definer RPC, so a token cannot be probed
-- for existence through the REST API.
drop policy if exists board_invites_owner_all on public.board_invites;
create policy board_invites_owner_all on public.board_invites for all to authenticated
  using (public.is_board_owner(board_id)) with check (public.is_board_owner(board_id));

-- --- content tables --------------------------------------------------------
-- Read = any member, including viewers. Write = owners and editors.
do $$
declare t text;
begin
  foreach t in array array['members', 'labels', 'tasks',
                            'task_assignees', 'task_labels', 'comments']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated
                      using (public.is_board_member(board_id))', t || '_read', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated
                      with check (public.can_edit_board(board_id))', t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated
                      using (public.can_edit_board(board_id))
                      with check (public.can_edit_board(board_id))', t || '_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated
                      using (public.can_edit_board(board_id))', t || '_delete', t);
  end loop;
end $$;

-- --- retire the pre-sharing policies --------------------------------------
-- The first migration gave every table a single-user `*_owner_all` policy and a
-- helper called owns_task(). Both are obsolete: membership decides access now.
-- They are dropped explicitly because RLS policies are PERMISSIVE and combine
-- with OR — a surviving `tasks_owner_all` would quietly grant a task's original
-- creator access even after they left the board.
drop policy if exists members_owner_all        on public.members;
drop policy if exists labels_owner_all         on public.labels;
drop policy if exists tasks_owner_all          on public.tasks;
drop policy if exists task_assignees_owner_all on public.task_assignees;
drop policy if exists task_labels_owner_all    on public.task_labels;
drop policy if exists comments_owner_all       on public.comments;
drop policy if exists activity_owner_read      on public.activity;
drop policy if exists activity_owner_insert    on public.activity;
drop function if exists public.owns_task(uuid);

-- --- activity: append-only -------------------------------------------------
-- No UPDATE or DELETE policy exists, so history cannot be rewritten through the
-- API. Cascading deletes still clean up, because cascades run outside RLS.
drop policy if exists activity_read on public.activity;
create policy activity_read on public.activity for select to authenticated
  using (public.is_board_member(board_id));

drop policy if exists activity_insert on public.activity;
create policy activity_insert on public.activity for insert to authenticated
  with check (public.is_board_member(board_id));

-- ---------------------------------------------------------------------------
-- 6. GRANTS
--
-- Postgres access control has two independent layers and a statement must pass
-- BOTH: GRANT decides whether a role may touch the table at all, RLS decides
-- which rows. Policies alone are not enough — without a grant, PostgREST fails
-- with 42501 "permission denied" before any policy is consulted.
--
-- `anon` is granted nothing, deliberately. A caller holding only the publishable
-- key and no session must not read a single row. Guests call
-- signInAnonymously() first, which upgrades them to `authenticated`.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on
  public.boards, public.board_members, public.board_invites,
  public.members, public.labels, public.tasks,
  public.task_assignees, public.task_labels, public.comments
  to authenticated;

grant select, insert on public.activity to authenticated;

revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- 7. TRIGGERS
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists tasks_touch_updated_at on public.tasks;
create trigger tasks_touch_updated_at before update on public.tasks
  for each row execute function public.touch_updated_at();

-- A child row's board is dictated by its parent task, never by the client.
-- Without this, a crafted request could file a comment under a board the caller
-- happens to belong to while pointing it at someone else's task.
create or replace function public.inherit_board_from_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_board uuid;
begin
  select board_id into v_board from public.tasks where id = new.task_id;
  if v_board is null then
    raise exception 'task % does not exist', new.task_id;
  end if;
  new.board_id := v_board;
  return new;
end $$;

drop trigger if exists task_assignees_board on public.task_assignees;
create trigger task_assignees_board before insert or update on public.task_assignees
  for each row execute function public.inherit_board_from_task();

drop trigger if exists task_labels_board on public.task_labels;
create trigger task_labels_board before insert or update on public.task_labels
  for each row execute function public.inherit_board_from_task();

drop trigger if exists comments_board on public.comments;
create trigger comments_board before insert or update on public.comments
  for each row execute function public.inherit_board_from_task();

-- Joining a board creates the assignable member row, with the real email read
-- from auth.users (not reachable from the browser, by design). One trigger
-- rather than duplicating this in three RPCs.
--
-- There is deliberately no AFTER DELETE counterpart: losing access keeps the
-- member row, so a card never silently loses its assignee and the activity log
-- never grows holes.
create or replace function public.ensure_member_for_board_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_name  text;
  v_slot  int;
begin
  select email into v_email from auth.users where id = new.user_id;
  v_name := coalesce(nullif(split_part(coalesce(v_email, ''), '@', 1), ''), 'Teammate');

  -- Deterministic colour from the user id, so one person is the same colour on
  -- every board. Not abs(): hashtext can return INT_MIN, where abs() overflows.
  v_slot := ((hashtext(new.user_id::text) % 10) + 10) % 10;

  if not exists (select 1 from public.members
                  where board_id = new.board_id and auth_user_id = new.user_id) then
    insert into public.members (board_id, user_id, name, email, auth_user_id, color)
    values (new.board_id, new.user_id, left(v_name, 60), v_email, new.user_id,
            (array['#d4756b','#5b7c99','#8a9a6b','#9b7fb5','#c58a3c',
                   '#4f8a6b','#a8697f','#6b8c9e','#b5834f','#7a7fb5'])[v_slot + 1]);
  else
    update public.members set email = v_email
     where board_id = new.board_id and auth_user_id = new.user_id;
  end if;

  return new;
end $$;

drop trigger if exists board_members_ensure_member on public.board_members;
create trigger board_members_ensure_member after insert on public.board_members
  for each row execute function public.ensure_member_for_board_member();

-- Activity log, written server-side.
create or replace function public.log_task_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity (task_id, board_id, user_id, kind, to_value)
    values (new.id, new.board_id, new.user_id, 'created', new.title);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.activity (task_id, board_id, user_id, kind, from_value, to_value)
    values (new.id, new.board_id, coalesce((select auth.uid()), new.user_id),
            'status', old.status, new.status);
  end if;

  if new.title       is distinct from old.title
  or new.priority    is distinct from old.priority
  or new.due_date    is distinct from old.due_date
  or new.description is distinct from old.description then
    insert into public.activity (task_id, board_id, user_id, kind, from_value, to_value)
    values (new.id, new.board_id, coalesce((select auth.uid()), new.user_id), 'edited',
      case
        when new.title    is distinct from old.title    then 'title'
        when new.priority is distinct from old.priority then 'priority'
        when new.due_date is distinct from old.due_date then 'due date'
        else 'description'
      end, new.title);
  end if;

  return new;
end $$;

drop trigger if exists tasks_activity_ins on public.tasks;
create trigger tasks_activity_ins after insert on public.tasks
  for each row execute function public.log_task_activity();

drop trigger if exists tasks_activity_upd on public.tasks;
create trigger tasks_activity_upd after update on public.tasks
  for each row execute function public.log_task_activity();

create or replace function public.log_link_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_kind   text;
  v_label  text;
  v_task   uuid;
  v_board  uuid;
  v_author uuid;
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
  else
    v_task := new.task_id;
    v_kind := 'commented';
    v_label := left(new.body, 80);
  end if;

  -- The task's creator is the fallback author. A literal zero uuid would violate
  -- activity.user_id's foreign key the moment auth.uid() is null.
  select board_id, user_id into v_board, v_author from public.tasks where id = v_task;
  if v_board is null then
    return coalesce(new, old);
  end if;

  insert into public.activity (task_id, board_id, user_id, kind, to_value)
  values (v_task, v_board, coalesce((select auth.uid()), v_author), v_kind, v_label);

  return coalesce(new, old);
end $$;

drop trigger if exists task_assignees_activity on public.task_assignees;
create trigger task_assignees_activity after insert or delete on public.task_assignees
  for each row execute function public.log_link_activity();

drop trigger if exists task_labels_activity on public.task_labels;
create trigger task_labels_activity after insert or delete on public.task_labels
  for each row execute function public.log_link_activity();

drop trigger if exists comments_activity on public.comments;
create trigger comments_activity after insert on public.comments
  for each row execute function public.log_link_activity();

-- ---------------------------------------------------------------------------
-- 8. RPCs
-- ---------------------------------------------------------------------------

-- Board plus owner row in one transaction. Two separate client inserts could
-- fail between them and leave a board nobody can reach.
create or replace function public.create_board(p_name text default 'My board')
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_uid   uuid := (select auth.uid());
  v_board uuid;
begin
  if v_uid is null then
    raise exception 'You must be signed in to create a board.';
  end if;

  insert into public.boards (owner_id, name)
  values (v_uid, coalesce(nullif(btrim(p_name), ''), 'My board'))
  returning id into v_board;

  insert into public.board_members (board_id, user_id, role)
  values (v_board, v_uid, 'owner');

  return v_board;
end $$;

-- URL-safe token from 32 random bytes (~256 bits).
--
-- gen_random_uuid() and not pgcrypto's gen_random_bytes(): Supabase installs
-- extensions into the `extensions` schema, and every function here is pinned to
-- `set search_path = public`, so pgcrypto is invisible from inside them and the
-- call fails with "function gen_random_bytes(integer) does not exist".
-- gen_random_uuid() is core Postgres 13+, in pg_catalog, always reachable.
--
-- translate() drops '=' padding and any newline encode() might wrap in:
-- characters past the end of the replacement string are deleted.
create or replace function public.gen_invite_token()
returns text language sql volatile
set search_path = pg_catalog, public
as $$
  select translate(
           encode(
             decode(
               replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
               'hex'
             ),
             'base64'
           ),
           '+/=' || chr(10) || chr(13),
           '-_'
         );
$$;

-- p_expires_in is TEXT, not interval, and this matters. PostgREST resolves a
-- function by parameter names and by whether the JSON value types coerce to the
-- declared types — and it will not coerce a JSON string into `interval`. Declared
-- as interval, this endpoint answers 404, indistinguishable from a function that
-- does not exist. Postgres does the parsing instead, inside the body.
--
-- Dropped explicitly first: changing a parameter's TYPE does not replace a
-- function, it adds an overload. Two four-argument versions with identical
-- parameter names would leave PostgREST unable to choose between them.
drop function if exists public.create_board_invite(uuid, text, interval, integer);

create or replace function public.create_board_invite(
  p_board uuid, p_role text default 'editor',
  p_expires_in text default '14 days',
  p_max_uses integer default null
) returns text language plpgsql security invoker set search_path = public as $$
declare
  v_token   text;
  v_expires timestamptz;
begin
  if not public.is_board_owner(p_board) then
    raise exception 'Only the board owner can create invite links.';
  end if;

  -- Guests may JOIN a shared board but not share one: a board owned by an
  -- anonymous session that vanishes when the browser is cleared is a bad thing
  -- to own.
  if coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
    raise exception 'Create an account before sharing a board.';
  end if;

  if p_role not in ('editor', 'viewer') then
    raise exception 'Role must be editor or viewer.';
  end if;

  if p_expires_in is null or btrim(p_expires_in) = '' then
    v_expires := null;
  else
    begin
      v_expires := now() + p_expires_in::interval;
    exception when others then
      raise exception 'Could not read "%" as a duration. Try something like "14 days".',
        p_expires_in;
    end;
  end if;

  v_token := public.gen_invite_token();
  insert into public.board_invites (board_id, token, role, expires_at, max_uses)
  values (p_board, v_token, p_role, v_expires, p_max_uses);
  return v_token;
end $$;

-- SECURITY DEFINER because the caller is by definition not yet a member, so
-- under normal policies they can neither read board_invites nor insert into
-- board_members.
create or replace function public.redeem_board_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := (select auth.uid());
  v_inv public.board_invites;
begin
  if v_uid is null then
    raise exception 'Sign in before opening an invite link.';
  end if;

  select * into v_inv from public.board_invites
   where token = btrim(p_token)
     and revoked_at is null
     and (expires_at is null or expires_at > now())
     and (max_uses is null or uses < max_uses);

  if not found then
    -- One message for every failure mode, so a wrong token cannot be
    -- distinguished from an expired, revoked or exhausted one.
    raise exception 'That invite link is no longer valid.';
  end if;

  if exists (select 1 from public.board_members
              where board_id = v_inv.board_id and user_id = v_uid) then
    return v_inv.board_id;
  end if;

  -- The trigger in section 7 creates the members row.
  insert into public.board_members (board_id, user_id, role)
  values (v_inv.board_id, v_uid, v_inv.role);

  update public.board_invites set uses = uses + 1 where id = v_inv.id;
  return v_inv.board_id;
end $$;

revoke all on function public.create_board(text) from public, anon;
grant execute on function public.create_board(text) to authenticated;
revoke all on function public.create_board_invite(uuid, text, text, integer) from public, anon;
grant execute on function public.create_board_invite(uuid, text, text, integer) to authenticated;
revoke all on function public.redeem_board_invite(text) from public, anon;
grant execute on function public.redeem_board_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. STARTER CONTENT
-- Called once by the client immediately after a session is established, so a
-- first-time visitor sees a working board rather than four empty columns.
-- ---------------------------------------------------------------------------
create or replace function public.seed_starter_board()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := (select auth.uid());
  v_board   uuid;
  v_me      uuid;
  v_design  uuid;
  v_bug     uuid;
  v_feature uuid;
  v_task    uuid;
begin
  if v_uid is null then
    raise exception 'seed_starter_board must be called by a signed-in user';
  end if;

  -- Idempotent: never seed anyone who already belongs to a board.
  select bm.board_id into v_board from public.board_members bm
   where bm.user_id = v_uid order by bm.joined_at limit 1;
  if v_board is not null then
    return v_board;
  end if;

  insert into public.boards (owner_id, name) values (v_uid, 'My board')
  returning id into v_board;

  -- Fires ensure_member_for_board_member(), which creates the members row.
  insert into public.board_members (board_id, user_id, role)
  values (v_board, v_uid, 'owner');
  select id into v_me from public.members
   where board_id = v_board and auth_user_id = v_uid;

  insert into public.labels (board_id, user_id, name, color)
  values (v_board, v_uid, 'Design', '#9b7fb5') returning id into v_design;
  insert into public.labels (board_id, user_id, name, color)
  values (v_board, v_uid, 'Bug', '#c1544a') returning id into v_bug;
  insert into public.labels (board_id, user_id, name, color)
  values (v_board, v_uid, 'Feature', '#4f8a6b') returning id into v_feature;

  insert into public.tasks (board_id, user_id, title, description, status, priority, due_date, position)
  values (v_board, v_uid, 'Welcome to Scribbly',
          E'Drag this card into another column to see the status update stick.\n\nClick it to open the detail panel — comments and an activity log live in there.',
          'todo', 'normal', current_date + 3, 1000)
  returning id into v_task;
  if v_me is not null then
    insert into public.task_assignees (board_id, user_id, task_id, member_id)
    values (v_board, v_uid, v_task, v_me);
  end if;
  insert into public.task_labels (board_id, user_id, task_id, label_id)
  values (v_board, v_uid, v_task, v_feature);

  -- Deliberately due yesterday, so a new board demonstrates the overdue badge.
  insert into public.tasks (board_id, user_id, title, status, priority, due_date, position)
  values (v_board, v_uid, 'Launch Demo Video', 'in_progress', 'high', current_date - 1, 1000)
  returning id into v_task;
  insert into public.task_labels (board_id, user_id, task_id, label_id)
  values (v_board, v_uid, v_task, v_design);

  insert into public.tasks (board_id, user_id, title, status, priority, due_date, position)
  values (v_board, v_uid, 'Weekly code evaluation/review', 'in_review', 'high', current_date, 1000);

  insert into public.tasks (board_id, user_id, title, status, priority, position)
  values (v_board, v_uid, 'Submit Internship application', 'done', 'normal', 1000);

  return v_board;
end $$;

revoke all on function public.seed_starter_board() from public, anon;
grant execute on function public.seed_starter_board() to authenticated;

-- ---------------------------------------------------------------------------
-- 10. REALTIME
-- RLS applies to the change feed too, so the board_id filter used by the client
-- is a performance choice rather than the security boundary.
-- ---------------------------------------------------------------------------
do $$
begin alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null; when undefined_object then null; end $$;

do $$
begin alter publication supabase_realtime add table public.board_members;
exception when duplicate_object then null; when undefined_object then null; end $$;
