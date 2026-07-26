-- ============================================================================
-- 002 — Shared boards
--
-- Turns Scribbly from "one private board per user" into "boards with members".
-- Run AFTER schema.sql. Idempotent: safe to re-run.
--
-- WHAT CHANGES
--   * New tables: boards, board_members, board_invites
--   * Every content table gains board_id; access is decided by board membership
--     instead of by user_id
--   * user_id survives as *authorship* (who created the row), not ownership —
--     that's what keeps comment and activity attribution meaningful
--   * Existing rows are migrated into one personal board per user, so nothing
--     is lost and no one has to start over
--
-- DESIGN NOTES
--   * Joining happens by redeeming a high-entropy invite token, not by email.
--     auth.users is not readable from the browser (deliberately — it would be
--     an account-enumeration oracle), so any "does this email have an account"
--     check needs service_role in an Edge Function. A secret link needs none of
--     that and works for people who haven't signed up yet.
--   * Guests CAN join a shared board, but CANNOT create invites. Sharing
--     requires an account, because a board owned by an anonymous session that
--     evaporates when the browser is cleared is a bad thing to own.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------------

create table if not exists public.boards (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid()
               references auth.users (id) on delete cascade,
  name       text not null default 'My board'
               check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);

-- Who may see/edit a board. This is the access-control table.
create table if not exists public.board_members (
  board_id  uuid not null references public.boards (id)  on delete cascade,
  user_id   uuid not null references auth.users (id)     on delete cascade,
  role      text not null default 'editor'
              check (role in ('owner', 'editor', 'viewer')),
  joined_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

-- Secret links. The token is generated server-side in create_board_invite() so
-- the client never gets to pick a weak one.
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
-- 2. board_id ON THE CONTENT TABLES
-- Added nullable so the backfill can run, then made NOT NULL at the end.
-- ---------------------------------------------------------------------------
alter table public.members        add column if not exists board_id uuid references public.boards (id) on delete cascade;
alter table public.labels         add column if not exists board_id uuid references public.boards (id) on delete cascade;
alter table public.tasks          add column if not exists board_id uuid references public.boards (id) on delete cascade;
alter table public.task_assignees add column if not exists board_id uuid references public.boards (id) on delete cascade;
alter table public.task_labels    add column if not exists board_id uuid references public.boards (id) on delete cascade;
alter table public.comments       add column if not exists board_id uuid references public.boards (id) on delete cascade;
alter table public.activity       add column if not exists board_id uuid references public.boards (id) on delete cascade;

-- A member row can now point at a real account, so joining a board makes you
-- immediately assignable rather than leaving a name nobody can pick.
alter table public.members add column if not exists auth_user_id uuid
  references auth.users (id) on delete set null;
alter table public.members add column if not exists email text;

-- schema.sql made label names unique per USER. On a shared board that's wrong:
-- two members could each create their own "Bug" and the board would show
-- duplicates. Uniqueness belongs to the board now.
alter table public.labels drop constraint if exists labels_user_id_name_key;
do $$
begin
  alter table public.labels add constraint labels_board_name_key unique (board_id, name);
exception
  when duplicate_table then null;   -- constraint already present
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 3. BACKFILL
-- Give every pre-existing user a personal board and move their rows onto it.
-- Guarded so re-running does nothing.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_board uuid;
begin
  for r in
    select distinct user_id from public.tasks   where board_id is null
    union select distinct user_id from public.members where board_id is null
    union select distinct user_id from public.labels  where board_id is null
  loop
    -- Reuse the board we already made for them if this is a partial re-run.
    select id into v_board
      from public.boards
     where owner_id = r.user_id
     order by created_at
     limit 1;

    if v_board is null then
      insert into public.boards (owner_id, name)
      values (r.user_id, 'My board')
      returning id into v_board;
    end if;

    insert into public.board_members (board_id, user_id, role)
    values (v_board, r.user_id, 'owner')
    on conflict (board_id, user_id) do update set role = 'owner';

    update public.members        set board_id = v_board where user_id = r.user_id and board_id is null;
    update public.labels         set board_id = v_board where user_id = r.user_id and board_id is null;
    update public.tasks          set board_id = v_board where user_id = r.user_id and board_id is null;
    update public.task_assignees set board_id = v_board where user_id = r.user_id and board_id is null;
    update public.task_labels    set board_id = v_board where user_id = r.user_id and board_id is null;
    update public.comments       set board_id = v_board where user_id = r.user_id and board_id is null;
    update public.activity       set board_id = v_board where user_id = r.user_id and board_id is null;
  end loop;
end $$;

-- Anything still null has no owner to attribute it to; drop it rather than
-- leave unreachable rows behind.
delete from public.activity       where board_id is null;
delete from public.comments       where board_id is null;
delete from public.task_labels    where board_id is null;
delete from public.task_assignees where board_id is null;
delete from public.tasks          where board_id is null;
delete from public.labels         where board_id is null;
delete from public.members        where board_id is null;

alter table public.members        alter column board_id set not null;
alter table public.labels         alter column board_id set not null;
alter table public.tasks          alter column board_id set not null;
alter table public.task_assignees alter column board_id set not null;
alter table public.task_labels    alter column board_id set not null;
alter table public.comments       alter column board_id set not null;
alter table public.activity       alter column board_id set not null;

-- ---------------------------------------------------------------------------
-- 4. INDEXES
-- Every policy and every query now filters on board_id.
-- ---------------------------------------------------------------------------
create index if not exists boards_owner_idx           on public.boards (owner_id);
create index if not exists board_members_user_idx     on public.board_members (user_id);
create index if not exists board_invites_board_idx    on public.board_invites (board_id);
create index if not exists tasks_board_status_pos_idx on public.tasks (board_id, status, position);
create index if not exists members_board_idx          on public.members (board_id);
create index if not exists labels_board_idx           on public.labels (board_id);
create index if not exists comments_board_idx         on public.comments (board_id);
create index if not exists activity_board_idx         on public.activity (board_id);

-- ---------------------------------------------------------------------------
-- 5. MEMBERSHIP HELPERS
--
-- These are SECURITY DEFINER for a specific reason: the policy ON
-- board_members needs to ask "is the caller a member of this board?", which
-- means reading board_members. If that read went through RLS it would invoke
-- the same policy again — infinite recursion, and Postgres raises
-- "infinite recursion detected in policy for relation board_members".
-- A definer function reads the table with RLS bypassed, which breaks the cycle.
--
-- They leak nothing: each returns a single boolean about the *calling* user.
-- ---------------------------------------------------------------------------

create or replace function public.is_board_member(p_board uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.board_members
    where board_id = p_board and user_id = (select auth.uid())
  );
$$;

create or replace function public.can_edit_board(p_board uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.board_members
    where board_id = p_board
      and user_id = (select auth.uid())
      and role in ('owner', 'editor')
  );
$$;

create or replace function public.is_board_owner(p_board uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.board_members
    where board_id = p_board
      and user_id = (select auth.uid())
      and role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- 6. POLICIES — replacing the owner-only ones from schema.sql
--
-- Read  = any member (including viewers)
-- Write = owners and editors
-- ---------------------------------------------------------------------------

alter table public.boards         enable row level security;
alter table public.board_members  enable row level security;
alter table public.board_invites  enable row level security;
alter table public.boards         force row level security;
alter table public.board_members  force row level security;
alter table public.board_invites  force row level security;

-- --- boards ---------------------------------------------------------------
drop policy if exists boards_select on public.boards;
create policy boards_select on public.boards
  for select to authenticated
  using (public.is_board_member(id));

drop policy if exists boards_insert on public.boards;
create policy boards_insert on public.boards
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists boards_update on public.boards;
create policy boards_update on public.boards
  for update to authenticated
  using (public.is_board_owner(id))
  with check (public.is_board_owner(id));

drop policy if exists boards_delete on public.boards;
create policy boards_delete on public.boards
  for delete to authenticated
  using (public.is_board_owner(id));

-- --- board_members --------------------------------------------------------
drop policy if exists board_members_select on public.board_members;
create policy board_members_select on public.board_members
  for select to authenticated
  using (public.is_board_member(board_id));

-- You may add yourself as owner of a board you just created (the only case
-- where you're not yet a member). Everything else goes through
-- redeem_board_invite(), which is SECURITY DEFINER.
drop policy if exists board_members_insert_self_owner on public.board_members;
create policy board_members_insert_self_owner on public.board_members
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and role = 'owner'
    and exists (
      select 1 from public.boards
      where id = board_id and owner_id = (select auth.uid())
    )
  );

drop policy if exists board_members_update on public.board_members;
create policy board_members_update on public.board_members
  for update to authenticated
  using (public.is_board_owner(board_id))
  with check (public.is_board_owner(board_id));

-- Owners can remove anyone; anyone can remove themselves (leave a board).
drop policy if exists board_members_delete on public.board_members;
create policy board_members_delete on public.board_members
  for delete to authenticated
  using (public.is_board_owner(board_id) or user_id = (select auth.uid()));

-- --- board_invites --------------------------------------------------------
-- Only owners can see or manage links. Note there is NO policy letting a
-- non-member read by token: redemption goes through the definer RPC, so a
-- token cannot be probed for existence through the REST API.
drop policy if exists board_invites_owner_all on public.board_invites;
create policy board_invites_owner_all on public.board_invites
  for all to authenticated
  using (public.is_board_owner(board_id))
  with check (public.is_board_owner(board_id));

-- --- content tables -------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['members', 'labels', 'tasks', 'task_assignees', 'task_labels', 'comments']
  loop
    -- retire the single-user policies from schema.sql
    execute format('drop policy if exists %I on public.%I', t || '_owner_all', t);

    -- One statement per EXECUTE. plpgsql will accept several separated by
    -- semicolons, but it's undocumented behaviour and silently discards all
    -- but the last result — not worth relying on.
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.is_board_member(board_id))',
      t || '_read', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.can_edit_board(board_id))',
      t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.can_edit_board(board_id))
         with check (public.can_edit_board(board_id))',
      t || '_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (public.can_edit_board(board_id))',
      t || '_delete', t);
  end loop;
end $$;

-- activity stays append-only: readable by members, insertable, never editable.
drop policy if exists activity_owner_read   on public.activity;
drop policy if exists activity_owner_insert on public.activity;

drop policy if exists activity_read on public.activity;
create policy activity_read on public.activity
  for select to authenticated
  using (public.is_board_member(board_id));

drop policy if exists activity_insert on public.activity;
create policy activity_insert on public.activity
  for insert to authenticated
  with check (public.is_board_member(board_id));

-- owns_task() is obsolete: board membership now decides access, and a child
-- row's board_id is checked directly.
drop function if exists public.owns_task(uuid);

-- ---------------------------------------------------------------------------
-- 7. GRANTS
-- Same two-layer model as before: GRANT decides "may this role touch the
-- table", RLS decides "which rows". anon still gets nothing.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on
  public.boards, public.board_members, public.board_invites
  to authenticated;
revoke all on public.boards        from anon;
revoke all on public.board_members from anon;
revoke all on public.board_invites from anon;

-- ---------------------------------------------------------------------------
-- 8. TRIGGERS — keep board_id on child rows consistent with their parent
-- ---------------------------------------------------------------------------
create or replace function public.inherit_board_from_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board uuid;
begin
  select board_id into v_board from public.tasks where id = new.task_id;
  if v_board is null then
    raise exception 'task % does not exist', new.task_id;
  end if;
  -- Ignore whatever the client sent; the parent is the authority. Stops a
  -- child row being filed under a board the caller happens to belong to.
  new.board_id := v_board;
  return new;
end $$;

drop trigger if exists task_assignees_board on public.task_assignees;
create trigger task_assignees_board
  before insert or update on public.task_assignees
  for each row execute function public.inherit_board_from_task();

drop trigger if exists task_labels_board on public.task_labels;
create trigger task_labels_board
  before insert or update on public.task_labels
  for each row execute function public.inherit_board_from_task();

drop trigger if exists comments_board on public.comments;
create trigger comments_board
  before insert or update on public.comments
  for each row execute function public.inherit_board_from_task();

-- The activity triggers from schema.sql need to carry board_id through too.
create or replace function public.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
    values (
      new.id, new.board_id, coalesce((select auth.uid()), new.user_id), 'edited',
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

create or replace function public.log_link_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

  -- Take the task's creator as the fallback author. A literal zero uuid would
  -- violate activity.user_id's foreign key to auth.users the moment auth.uid()
  -- is null (a trigger fired from SQL editor or a cascade, for instance).
  select board_id, user_id into v_board, v_author
    from public.tasks where id = v_task;
  if v_board is null then
    return coalesce(new, old);
  end if;

  insert into public.activity (task_id, board_id, user_id, kind, to_value)
  values (v_task, v_board, coalesce((select auth.uid()), v_author), v_kind, v_label);

  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------------
-- 9. RPCs
-- ---------------------------------------------------------------------------

-- Create a board and make the caller its owner, in one transaction. Without
-- this the client would insert the board, then insert board_members, and a
-- failure between the two would leave a board nobody can reach.
create or replace function public.create_board(p_name text default 'My board')
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
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

-- URL-safe token from 24 random bytes (~192 bits).
create or replace function public.gen_invite_token()
returns text
language sql
volatile
as $$
  select translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');
$$;

create or replace function public.create_board_invite(
  p_board      uuid,
  p_role       text default 'editor',
  p_expires_in interval default interval '14 days',
  p_max_uses   integer default null
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_token text;
begin
  if not public.is_board_owner(p_board) then
    raise exception 'Only the board owner can create invite links.';
  end if;

  -- Guests may JOIN a shared board but may not share one: an anonymous session
  -- disappears when the browser is cleared, which is a bad thing to own.
  if coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
    raise exception 'Create an account before sharing a board.';
  end if;

  if p_role not in ('editor', 'viewer') then
    raise exception 'Role must be editor or viewer.';
  end if;

  v_token := public.gen_invite_token();

  insert into public.board_invites (board_id, token, role, expires_at, max_uses)
  values (p_board, v_token, p_role,
          case when p_expires_in is null then null else now() + p_expires_in end,
          p_max_uses);

  return v_token;
end $$;

-- Redeem a token. SECURITY DEFINER because the caller is by definition not yet
-- a member, so under normal policies they can neither read board_invites nor
-- insert into board_members.
create or replace function public.redeem_board_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_inv   public.board_invites;
  v_email text;
  v_name  text;
begin
  if v_uid is null then
    raise exception 'Sign in before opening an invite link.';
  end if;

  select * into v_inv
    from public.board_invites
   where token = btrim(p_token)
     and revoked_at is null
     and (expires_at is null or expires_at > now())
     and (max_uses is null or uses < max_uses);

  if not found then
    -- One message for every failure mode, so a wrong token can't be
    -- distinguished from an expired or revoked one.
    raise exception 'That invite link is no longer valid.';
  end if;

  -- Already a member? Return the board and change nothing.
  if exists (
    select 1 from public.board_members
     where board_id = v_inv.board_id and user_id = v_uid
  ) then
    return v_inv.board_id;
  end if;

  insert into public.board_members (board_id, user_id, role)
  values (v_inv.board_id, v_uid, v_inv.role);

  update public.board_invites set uses = uses + 1 where id = v_inv.id;

  -- Make the new arrival assignable straight away, linked to their account.
  select email into v_email from auth.users where id = v_uid;
  v_name := coalesce(split_part(v_email, '@', 1), 'Teammate');

  if not exists (
    select 1 from public.members
     where board_id = v_inv.board_id and auth_user_id = v_uid
  ) then
    insert into public.members (board_id, user_id, name, email, auth_user_id, color)
    values (v_inv.board_id, v_uid, left(v_name, 60), v_email, v_uid, '#5b7c99');
  end if;

  return v_inv.board_id;
end $$;

revoke all on function public.redeem_board_invite(text) from public, anon;
grant execute on function public.redeem_board_invite(text) to authenticated;
revoke all on function public.create_board_invite(uuid, text, interval, integer) from public, anon;
grant execute on function public.create_board_invite(uuid, text, interval, integer) to authenticated;
revoke all on function public.create_board(text) from public, anon;
grant execute on function public.create_board(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. STARTER CONTENT — now board-aware
-- ---------------------------------------------------------------------------
-- schema.sql declares this as `returns void`; the board-aware version returns
-- the new board's id. CREATE OR REPLACE cannot change a function's return type
-- ("cannot change return type of existing function"), so drop it first.
drop function if exists public.seed_starter_board();

create or replace function public.seed_starter_board()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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

  -- Idempotent: never seed someone who already belongs to a board.
  select bm.board_id into v_board
    from public.board_members bm
   where bm.user_id = v_uid
   order by bm.joined_at
   limit 1;
  if v_board is not null then
    return v_board;
  end if;

  insert into public.boards (owner_id, name) values (v_uid, 'My board')
  returning id into v_board;
  insert into public.board_members (board_id, user_id, role)
  values (v_board, v_uid, 'owner');

  insert into public.members (board_id, user_id, name, color, auth_user_id)
  values (v_board, v_uid, 'You', '#d4756b', v_uid)
  returning id into v_me;

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
  insert into public.task_assignees (board_id, user_id, task_id, member_id) values (v_board, v_uid, v_task, v_me);
  insert into public.task_labels (board_id, user_id, task_id, label_id) values (v_board, v_uid, v_task, v_feature);

  -- Seeded content is defined authoritatively in 003_real_members.sql; the
  -- titles below are kept in step so the two files never disagree.
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
-- 11. REALTIME
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null; when undefined_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.board_members;
exception when duplicate_object then null; when undefined_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 12. VERIFY
-- ---------------------------------------------------------------------------
-- select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' order by tablename;
--
-- select tablename, policyname, cmd from pg_policies
--   where schemaname = 'public' order by tablename, policyname;
--
-- -- every content row should now have a board
-- select 'tasks' t, count(*) filter (where board_id is null) as orphans from public.tasks;
