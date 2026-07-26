-- Members that are NOT linked to a real account: the hand-added "fake people".
-- on_cards / on_comments show exactly what deleting each one would take with it.
select
  m.name,
  coalesce(m.email, '—')                                          as email,
  b.name                                                          as board,
  (select count(*) from public.task_assignees ta where ta.member_id = m.id) as on_cards,
  (select count(*) from public.comments c      where c.author_id = m.id)    as on_comments
from public.members m
join public.boards b on b.id = m.board_id
where m.auth_user_id is null
order by b.name, m.name;
