-- ============================================================================
-- 003 — Members are real people, not hand-typed names
--
-- Run AFTER 002_collaboration.sql. Idempotent.
--
-- BEFORE: you typed a name into the Team panel and got an assignable "member"
--         who didn't exist anywhere.
-- AFTER:  a members row appears automatically for anyone who joins the board,
--         carrying their real email, and there is no way to invent one.
--
-- WHY members SURVIVES AS A TABLE
--   task_assignees.member_id and comments.author_id both point at members.id.
--   Dropping the table would mean migrating both and losing every existing
--   assignment. So it stops being hand-editable and becomes derived from
--   board_members instead.
--
-- TWO DELIBERATE ASYMMETRIES
--   * Joining a board CREATES a members row (trigger below).
--   * Losing access does NOT delete it. The row stays, and the UI greys it as
--     "no longer has access". A card shouldn't silently lose its assignee, and
--     the activity log shouldn't develop holes, just because someone left.
--   * Rows that never had an account at all (auth_user_id is null) are the old
--     invented people, and those ARE deleted — see section 3.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. A members row for every board member, automatically
--
-- One trigger rather than duplicating this in create_board(),
-- redeem_board_invite() and seed_starter_board(). Three copies of the same
-- logic is three places for it to drift.
--
-- SECURITY DEFINER because it reads auth.users for the email — that table is
-- not reachable from the browser, by design.
-- ---------------------------------------------------------------------------

create or replace function public.ensure_member_for_board_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_name  text;
  v_color text;
  v_slot  int;
begin
  select email into v_email from auth.users where id = new.user_id;

  -- Guests have no email, so fall back to something neutral. The UI shows
  -- "You" for your own row regardless of what's stored here.
  v_name := coalesce(nullif(split_part(coalesce(v_email, ''), '@', 1), ''), 'Teammate');

  /* Deterministic colour from the user id, so the same person is the same
     colour on every board and two arrivals rarely clash. Not abs(): hashtext
     can return INT_MIN, where abs() overflows. Double-mod keeps it in 0..9. */
  v_slot := ((hashtext(new.user_id::text) % 10) + 10) % 10;
  v_color := (array[
    '#d4756b', '#5b7c99', '#8a9a6b', '#9b7fb5', '#c58a3c',
    '#4f8a6b', '#a8697f', '#6b8c9e', '#b5834f', '#7a7fb5'
  ])[v_slot + 1];

  if not exists (
    select 1 from public.members
     where board_id = new.board_id and auth_user_id = new.user_id
  ) then
    insert into public.members (board_id, user_id, name, email, auth_user_id, color)
    values (new.board_id, new.user_id, left(v_name, 60), v_email, new.user_id, v_color);
  else
    -- Re-joining: refresh the email in case it changed while they were away.
    update public.members
       set email = v_email
     where board_id = new.board_id and auth_user_id = new.user_id;
  end if;

  return new;
end $$;

drop trigger if exists board_members_ensure_member on public.board_members;
create trigger board_members_ensure_member
  after insert on public.board_members
  for each row execute function public.ensure_member_for_board_member();

-- Note the absence of an AFTER DELETE trigger. That is the point: removing
-- someone's access leaves their members row in place.

-- ---------------------------------------------------------------------------
-- 2. BACKFILL — a members row for everyone who already has access
-- ---------------------------------------------------------------------------
do $$
declare
  r      record;
  v_name text;
  v_slot int;
  n      int := 0;
begin
  for r in
    select bm.board_id, bm.user_id, u.email
      from public.board_members bm
      join auth.users u on u.id = bm.user_id
     where not exists (
       select 1 from public.members m
        where m.board_id = bm.board_id and m.auth_user_id = bm.user_id
     )
  loop
    v_name := coalesce(nullif(split_part(coalesce(r.email, ''), '@', 1), ''), 'Teammate');
    v_slot := ((hashtext(r.user_id::text) % 10) + 10) % 10;

    insert into public.members (board_id, user_id, name, email, auth_user_id, color)
    values (r.board_id, r.user_id, left(v_name, 60), r.email, r.user_id,
            (array['#d4756b','#5b7c99','#8a9a6b','#9b7fb5','#c58a3c',
                   '#4f8a6b','#a8697f','#6b8c9e','#b5834f','#7a7fb5'])[v_slot + 1]);
    n := n + 1;
  end loop;

  raise notice '003: created % members row(s) for existing board members', n;
end $$;

-- ---------------------------------------------------------------------------
-- 3. DELETE THE INVENTED PEOPLE
--
-- Any members row with no auth_user_id was typed in by hand and corresponds to
-- nobody. The whole point of this migration is that the team list is truthful,
-- so these go.
--
-- What that takes with it:
--   task_assignees  ON DELETE CASCADE     — assignments to fictional people
--                                           disappear, which costs nothing
--   comments        ON DELETE SET NULL    — comments SURVIVE, attribution just
--                                           falls back to the board owner
--
-- The counts are raised as a notice rather than done silently.
-- ---------------------------------------------------------------------------
do $$
declare
  n_members  int;
  n_assigned int;
  n_comments int;
begin
  select count(*) into n_members  from public.members where auth_user_id is null;

  select count(*) into n_assigned
    from public.task_assignees ta
    join public.members m on m.id = ta.member_id
   where m.auth_user_id is null;

  select count(*) into n_comments
    from public.comments c
    join public.members m on m.id = c.author_id
   where m.auth_user_id is null;

  if n_members = 0 then
    raise notice '003: no hand-added members found — nothing to remove';
  else
    delete from public.members where auth_user_id is null;
    raise notice '003: removed % invented member(s); % card assignment(s) cleared, % comment(s) reattributed (not deleted)',
      n_members, n_assigned, n_comments;
  end if;
end $$;

-- Stop new ones appearing at the database level too, not just in the UI. Every
-- legitimate insert now comes from the trigger, which always sets auth_user_id.
alter table public.members drop constraint if exists members_must_be_real;
alter table public.members
  add constraint members_must_be_real check (auth_user_id is not null);

-- ---------------------------------------------------------------------------
-- 4. seed_starter_board() — let the trigger create the member row
-- Previously it inserted 'You' itself, which would now collide with the
-- trigger's row for the same person.
-- ---------------------------------------------------------------------------
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

  -- This insert fires ensure_member_for_board_member(), which creates the
  -- members row. Read it back rather than making a second one.
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

  -- Deliberately due yesterday, so a brand-new board demonstrates the overdue
  -- badge without anyone having to wait for a date to pass.
  insert into public.tasks (board_id, user_id, title, status, priority, due_date, position)
  values (v_board, v_uid, 'Launch Demo Video',
          'in_progress', 'high', current_date - 1, 1000)
  returning id into v_task;
  insert into public.task_labels (board_id, user_id, task_id, label_id)
  values (v_board, v_uid, v_task, v_design);

  insert into public.tasks (board_id, user_id, title, status, priority, due_date, position)
  values (v_board, v_uid, 'Weekly code evaluation/review',
          'in_review', 'high', current_date, 1000);

  insert into public.tasks (board_id, user_id, title, status, priority, position)
  values (v_board, v_uid, 'Submit Internship application', 'done', 'normal', 1000);

  return v_board;
end $$;

revoke all on function public.seed_starter_board() from public, anon;
grant execute on function public.seed_starter_board() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. redeem_board_invite() — same simplification
-- ---------------------------------------------------------------------------
create or replace function public.redeem_board_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_inv public.board_invites;
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
    -- distinguished from an expired, revoked or exhausted one.
    raise exception 'That invite link is no longer valid.';
  end if;

  if exists (
    select 1 from public.board_members
     where board_id = v_inv.board_id and user_id = v_uid
  ) then
    return v_inv.board_id;
  end if;

  -- The trigger creates the members row, including the email.
  insert into public.board_members (board_id, user_id, role)
  values (v_inv.board_id, v_uid, v_inv.role);

  update public.board_invites set uses = uses + 1 where id = v_inv.id;

  return v_inv.board_id;
end $$;

revoke all on function public.redeem_board_invite(text) from public, anon;
grant execute on function public.redeem_board_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. VERIFY
-- ---------------------------------------------------------------------------
-- -- every member is a real account, and every board member has a members row
-- select
--   (select count(*) from public.members where auth_user_id is null) as invented,
--   (select count(*) from public.board_members bm
--      where not exists (select 1 from public.members m
--                         where m.board_id = bm.board_id
--                           and m.auth_user_id = bm.user_id))       as missing;
-- -- both should be 0
