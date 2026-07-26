-- Did running the old schema.sql revert anything? All three rows should say OK.
select 'old single-user policies' as item,
       count(*)::text as found,
       case when count(*) = 0 then 'OK' else 'REVERTED — re-run 002 then 003' end as verdict
  from pg_policies
 where schemaname = 'public'
   and policyname in ('tasks_owner_all','members_owner_all','labels_owner_all',
                      'comments_owner_all','task_labels_owner_all',
                      'task_assignees_owner_all','activity_owner_read',
                      'activity_owner_insert')
union all
select 'obsolete owns_task function',
       count(*)::text,
       case when count(*) = 0 then 'OK' else 'REVERTED — re-run 002 then 003' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'owns_task'
union all
select 'membership policies present',
       count(*)::text,
       case when count(*) >= 24 then 'OK' else 'MISSING — re-run 002 then 003' end
  from pg_policies
 where schemaname = 'public'
   and (qual like '%is_board_member%' or qual like '%can_edit_board%'
        or with_check like '%can_edit_board%' or qual like '%is_board_owner%');
