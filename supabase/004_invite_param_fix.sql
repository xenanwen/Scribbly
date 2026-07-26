-- ============================================================================
-- 004 — create_board_invite() takes text, not interval
--
-- Run AFTER 003_real_members.sql. Idempotent.
--
-- THE BUG
--   The client calls the RPC with p_expires_in: '14 days' — a JSON string.
--   The function declared that parameter as `interval`.
--
--   PostgREST resolves a function by parameter NAMES and by whether the JSON
--   value types can be coerced to the declared types. It will not coerce a JSON
--   string into `interval`, so no candidate matched and it answered:
--
--     POST /rest/v1/rpc/create_board_invite  ->  404 Not Found
--
--   Which is the same status as a genuinely missing function. The function was
--   there the whole time — every object check passed and reloading the schema
--   cache changed nothing, because the cache was never the problem.
--
-- THE FIX
--   Accept `text` and cast to interval inside the function body. Postgres does
--   the parsing, PostgREST only has to pass a string through, and the client
--   stays exactly as it is.
--
-- WHY DROP AND NOT REPLACE
--   Changing a parameter's TYPE does not replace a function, it creates an
--   overload. Two four-argument functions with identical parameter names would
--   leave PostgREST unable to choose, turning a 404 into a 300 Multiple Choices.
-- ============================================================================

drop function if exists public.create_board_invite(uuid, text, interval, integer);
drop function if exists public.create_board_invite(uuid, text, text, integer);

create function public.create_board_invite(
  p_board      uuid,
  p_role       text default 'editor',
  -- Any string Postgres can read as an interval: '14 days', '1 hour',
  -- '30 minutes'. Null means the link never expires.
  p_expires_in text default '14 days',
  p_max_uses   integer default null
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_token   text;
  v_expires timestamptz;
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

  -- Parse here rather than at the API boundary. A bad string produces a clear
  -- message instead of a 404 that looks like a missing function.
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

revoke all on function public.create_board_invite(uuid, text, text, integer) from public, anon;
grant execute on function public.create_board_invite(uuid, text, text, integer) to authenticated;

-- Tell PostgREST to re-read the schema so the new signature is visible at once.
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- VERIFY — should return exactly one row reading:
--   p_board uuid, p_role text, p_expires_in text, p_max_uses integer
-- ---------------------------------------------------------------------------
-- select pg_get_function_identity_arguments(p.oid) as args
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname = 'create_board_invite';
