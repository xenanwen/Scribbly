with orphans as (
  select (select count(*) from public.tasks           where board_id is null)
       + (select count(*) from public.members         where board_id is null)
       + (select count(*) from public.labels          where board_id is null)
       + (select count(*) from public.comments        where board_id is null)
       + (select count(*) from public.activity        where board_id is null)
       + (select count(*) from public.task_labels     where board_id is null)
       + (select count(*) from public.task_assignees  where board_id is null) as n
),
norls as (
  select count(*) as n from pg_tables where schemaname = 'public' and not rowsecurity
),
anongrants as (
  select count(*) as n from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon'
),
tabs as (select count(*) as n from pg_tables where schemaname = 'public'),
ownerless as (
  select count(*) as n from public.boards b
   where not exists (select 1 from public.board_members m
                      where m.board_id = b.id and m.role = 'owner')
),
pols as (select count(*) as n from pg_policies where schemaname = 'public')
select 'orphaned rows'            as item, (select n from orphans)::text     as value, 'want 0'  as want,
       case when (select n from orphans) = 0 then 'PASS' else 'FAIL' end      as verdict
union all
select 'tables with RLS off',     (select n from norls)::text,       'want 0',
       case when (select n from norls) = 0 then 'PASS' else 'FAIL' end
union all
select 'anon table grants',       (select n from anongrants)::text,  'want 0',
       case when (select n from anongrants) = 0 then 'PASS' else 'FAIL' end
union all
select 'tables in public',        (select n from tabs)::text,        'want 10',
       case when (select n from tabs) = 10 then 'PASS' else 'CHECK' end
union all
select 'boards with no owner',    (select n from ownerless)::text,   'want 0',
       case when (select n from ownerless) = 0 then 'PASS' else 'FAIL' end
union all
select 'policies defined',        (select n from pols)::text,        'want 30+',
       case when (select n from pols) >= 30 then 'PASS' else 'FAIL' end
union all
select 'boards',        (select count(*)::text from public.boards),        '(info)', '-'
union all
select 'board members', (select count(*)::text from public.board_members), '(info)', '-'
union all
select 'tasks',         (select count(*)::text from public.tasks),         '(info)', '-'
order by verdict desc, item;
