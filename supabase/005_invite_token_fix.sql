-- ============================================================================
-- 005 — "Create link" fails: gen_random_bytes is not on the search_path
--
-- Run AFTER 004_invite_param_fix.sql. Idempotent.
--
-- THE BUG
--   Clicking "Create link" in the Share panel showed:
--
--     A table is missing. Run supabase/schema.sql in the Supabase SQL editor.
--
--   No table was missing. That message is friendlyError() matching the
--   substring "does not exist", and the real error underneath was:
--
--     42883  function gen_random_bytes(integer) does not exist
--
--   gen_random_bytes() comes from pgcrypto. On Supabase, extensions are
--   installed into the `extensions` schema, not `public` — so
--   `create extension if not exists pgcrypto` in 002 was a no-op that left the
--   function where it already was. Meanwhile create_board_invite() is declared
--   `set search_path = public`, and gen_invite_token() sets no search_path of
--   its own, so it inherits the caller's. Inside that call the only schema on
--   the path is `public` (plus pg_catalog, implicitly), and pgcrypto is
--   invisible. Every other function in the schema survived this because none of
--   them touch an extension.
--
-- THE FIX
--   Drop the pgcrypto dependency entirely. gen_random_uuid() lives in
--   pg_catalog in Postgres 13+, so it is reachable no matter how the search
--   path is pinned and no matter where a project keeps its extensions.
--
--   Two UUIDs are 32 random bytes (~256 bits), more than the 24 bytes the old
--   token used. Same URL-safe base64 alphabet, so existing links keep working
--   and nothing else in the app has to change.
--
--   search_path is also set explicitly on the function, so it no longer depends
--   on whatever its caller happened to have configured.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- CONFIRM THE CAUSE FIRST (optional)
-- Run this before the fix. If it returns `extensions` — or no rows at all —
-- this migration is the one you want.
-- ---------------------------------------------------------------------------
-- select n.nspname as pgcrypto_lives_in
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where p.proname = 'gen_random_bytes';

-- ---------------------------------------------------------------------------
-- THE FIX
-- ---------------------------------------------------------------------------
create or replace function public.gen_invite_token()
returns text
language sql
volatile
set search_path = pg_catalog, public
as $$
  -- Two UUIDs -> 32 random bytes -> URL-safe base64.
  -- translate() drops '=' padding and any newline encode() might wrap in,
  -- because characters past the end of the replacement string are deleted.
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

revoke all on function public.gen_invite_token() from public, anon;
grant execute on function public.gen_invite_token() to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- VERIFY — should return one 43-character token of [A-Za-z0-9_-] and nothing
-- else. Running it twice must give two different values.
-- ---------------------------------------------------------------------------
-- select public.gen_invite_token() as token,
--        length(public.gen_invite_token()) as len,
--        public.gen_invite_token() ~ '^[A-Za-z0-9_-]+$' as url_safe;
