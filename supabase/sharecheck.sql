-- Every object the Share feature needs. Anything MISSING is the culprit.
with expected(kind, name) as (values
  ('table','boards'), ('table','board_members'), ('table','board_invites'),
  ('function','is_board_member'), ('function','can_edit_board'),
  ('function','is_board_owner'), ('function','gen_invite_token'),
  ('function','create_board'), ('function','create_board_invite'),
  ('function','redeem_board_invite'), ('function','seed_starter_board'),
  ('function','ensure_member_for_board_member')
)
select e.kind, e.name,
       case
         when e.kind = 'table' then
           coalesce((select 'present' from pg_tables
                      where schemaname='public' and tablename=e.name), 'MISSING')
         else
           coalesce((select 'present' from pg_proc p
                      join pg_namespace n on n.oid=p.pronamespace
                     where n.nspname='public' and p.proname=e.name limit 1), 'MISSING')
       end as status
  from expected e
union all
select 'signature', 'create_board_invite args',
       coalesce((select pg_get_function_identity_arguments(p.oid)
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='create_board_invite' limit 1),
                'MISSING')
union all
select 'signature', 'seed_starter_board returns',
       coalesce((select pg_get_function_result(p.oid)
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='seed_starter_board' limit 1),
                'MISSING')
union all
select 'grant', 'board_invites to authenticated',
       coalesce((select string_agg(privilege_type, ',')
                   from information_schema.role_table_grants
                  where table_schema='public' and table_name='board_invites'
                    and grantee='authenticated'), 'MISSING')
union all
select 'grant', 'EXECUTE create_board_invite',
       coalesce((select 'granted' from information_schema.role_routine_grants
                  where routine_schema='public' and routine_name='create_board_invite'
                    and grantee='authenticated' limit 1), 'MISSING')
order by 1, 2;
