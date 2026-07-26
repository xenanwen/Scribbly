import { arrayMove } from '@dnd-kit/sortable'
import {
  positionBetween, needsRebalance, rebalance, byPosition, groupByStatus,
  matchesFilters, computeStats, urgencyOf, daysUntil, todayISO, initials, formatDue,
  memberAccess, memberRole, byAccessThenName,
} from '../src/lib/board'
import type { Task, Status, Filters, Member, BoardMember } from '../src/lib/types'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++ } else { fail++; console.log('  FAIL:', name, extra) }
}

const mk = (id: string, status: Status, position: number, over: Partial<Task> = {}): Task => ({
  id, title: id, description: null, status, priority: 'normal', due_date: null,
  position, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  assignee_ids: [], label_ids: [], ...over,
})

/* ---- Replicate Board.handleDragEnd exactly -------------------------------- */
function simulateDrop(all: Task[], activeId: string, toStatus: Status, overId: string): Task[] {
  const column = all.filter(t => t.status === toStatus).sort(byPosition)
  const oldIndex = column.findIndex(t => t.id === activeId)
  let newIndex = overId === toStatus ? column.length - 1 : column.findIndex(t => t.id === overId)
  if (newIndex < 0) newIndex = column.length - 1
  const reordered = arrayMove(column, oldIndex, newIndex)
  const position = positionBetween(reordered[newIndex - 1], reordered[newIndex + 1])
  return all.map(t => t.id === activeId ? { ...t, status: toStatus, position } : t)
}
const order = (all: Task[], s: Status) =>
  all.filter(t => t.status === s).sort(byPosition).map(t => t.id).join(',')

/* ============ 1. within-column reordering ================================= */
{
  let all = [mk('a','todo',1000), mk('b','todo',2000), mk('c','todo',3000), mk('d','todo',4000)]
  ok('baseline order', order(all,'todo') === 'a,b,c,d', order(all,'todo'))

  // drag 'd' up onto 'b'  -> a,d,b,c
  let r = simulateDrop(all,'d','todo','b')
  ok('drag last up onto 2nd', order(r,'todo') === 'a,d,b,c', order(r,'todo'))

  // drag 'a' down onto 'c' -> b,c,a,d
  r = simulateDrop(all,'a','todo','c')
  ok('drag first down onto 3rd', order(r,'todo') === 'b,c,a,d', order(r,'todo'))

  // drag 'a' onto 'b' (adjacent, downward) -> b,a,c,d
  r = simulateDrop(all,'a','todo','b')
  ok('adjacent swap down', order(r,'todo') === 'b,a,c,d', order(r,'todo'))

  // drag 'b' onto 'a' (adjacent, upward) -> b,a,c,d
  r = simulateDrop(all,'b','todo','a')
  ok('adjacent swap up', order(r,'todo') === 'b,a,c,d', order(r,'todo'))

  // drop on itself = no change
  r = simulateDrop(all,'c','todo','c')
  ok('drop on self is stable', order(r,'todo') === 'a,b,c,d', order(r,'todo'))
  ok('drop on self keeps position', r.find(t=>t.id==='c')!.position === 3000)
}

/* Sections 2-3 (drag simulation) moved to drag.test.ts, which models the
   real two-phase onDragOver/onDragEnd flow instead of a simplification. */

/* ============ 5. rebalance ================================================ */
{
  const col = [mk('a','todo',0.0001), mk('b','todo',0.0002), mk('c','todo',0.0003)]
  const fixed = rebalance(col)
  ok('rebalance to clean ints', JSON.stringify(fixed.map(f=>f.position)) === '[1000,2000,3000]')
  ok('rebalance preserves order', fixed.map(f=>f.id).join(',') === 'a,b,c')
  ok('needsRebalance true when tight', needsRebalance(mk('x','todo',1), mk('y','todo',1.00001)))
  ok('needsRebalance false when roomy', !needsRebalance(mk('x','todo',1000), mk('y','todo',2000)))
  ok('needsRebalance false at edges', !needsRebalance(undefined, mk('y','todo',2000)))
}

/* ============ 6. groupByStatus ============================================ */
{
  const all = [mk('a','todo',3000), mk('b','todo',1000), mk('c','done',1000)]
  const g = groupByStatus(all)
  ok('grouped sorted by position', g.todo.map(t=>t.id).join(',') === 'b,a')
  ok('all four keys present', ['todo','in_progress','in_review','done'].every(k => Array.isArray((g as any)[k])))
  ok('empty column is empty array', g.in_review.length === 0)
}

/* ============ 7. filters ================================================== */
{
  const base: Filters = { query:'', priorities:[], assigneeIds:[], labelIds:[] }
  const t = mk('t1','todo',1000,{ title:'Fix the Login Bug', description:'auth flow', priority:'high', assignee_ids:['m1'], label_ids:['l1'] })

  ok('empty filters match', matchesFilters(t, base))
  ok('query case-insensitive', matchesFilters(t, {...base, query:'login'}))
  ok('query matches description', matchesFilters(t, {...base, query:'AUTH'}))
  ok('query non-match rejected', !matchesFilters(t, {...base, query:'zzz'}))
  ok('whitespace query ignored', matchesFilters(t, {...base, query:'   '}))
  ok('priority match', matchesFilters(t, {...base, priorities:['high']}))
  ok('priority non-match', !matchesFilters(t, {...base, priorities:['low']}))
  ok('assignee match', matchesFilters(t, {...base, assigneeIds:['m1']}))
  ok('assignee non-match', !matchesFilters(t, {...base, assigneeIds:['m9']}))
  ok('label match', matchesFilters(t, {...base, labelIds:['l1']}))
  ok('multi-filter AND across types', !matchesFilters(t, {...base, priorities:['high'], labelIds:['l9']}))
  ok('OR within a type', matchesFilters(t, {...base, priorities:['low','high']}))
}

/* ============ 8. due dates & urgency ====================================== */
{
  const iso = (offsetDays: number) => {
    const d = new Date(); d.setDate(d.getDate() + offsetDays)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }
  ok('daysUntil today = 0', daysUntil(todayISO()) === 0)
  ok('daysUntil tomorrow = 1', daysUntil(iso(1)) === 1)
  ok('daysUntil yesterday = -1', daysUntil(iso(-1)) === -1)
  ok('urgency overdue', urgencyOf(iso(-3),'todo') === 'overdue')
  ok('urgency today', urgencyOf(iso(0),'todo') === 'today')
  ok('urgency soon (2d)', urgencyOf(iso(2),'todo') === 'soon')
  ok('urgency later (9d)', urgencyOf(iso(9),'todo') === 'later')
  ok('done is never overdue', urgencyOf(iso(-9),'done') === null)
  ok('no due date = null', urgencyOf(null,'todo') === null)
  ok('formatDue today', formatDue(iso(0)) === 'Today')
  ok('formatDue tomorrow', formatDue(iso(1)) === 'Tomorrow')
  ok('formatDue overdue wording', formatDue(iso(-4)) === '4d overdue')
}

/* ============ 9. stats ==================================================== */
{
  const iso = (o: number) => { const d=new Date(); d.setDate(d.getDate()+o)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
  const all = [
    mk('1','todo',1,{ due_date: iso(-1) }),
    mk('2','done',1,{ due_date: iso(-5) }),
    mk('3','done',2),
    mk('4','in_progress',1),
  ]
  const s = computeStats(all)
  ok('total', s.total === 4, String(s.total))
  ok('done count', s.done === 2, String(s.done))
  ok('overdue excludes done', s.overdue === 1, String(s.overdue))
  ok('percent', s.percentDone === 50, String(s.percentDone))
  const empty = computeStats([])
  ok('no divide-by-zero', empty.percentDone === 0)
}

/* ============ 10. initials ================================================ */
{
  ok('two names', initials('Ada Reyes') === 'AR')
  ok('one name', initials('Sam') === 'SA')
  ok('three names uses first+last', initials('Ana Maria Cruz') === 'AC')
  ok('extra spaces', initials('  Ada   Reyes  ') === 'AR')
  ok('empty', initials('') === '?')
  ok('single char', initials('X') === 'X')
}

/* ============ 11. member access state ===================================== */
{
  const mk2 = (id: string, name: string, authId: string | null): Member => ({
    id, name, color: '#5b7c99', created_at: '', email: authId ? `${name}@x.com` : null,
    auth_user_id: authId,
  })
  const access: BoardMember[] = [
    { board_id: 'b', user_id: 'u1', role: 'owner',  joined_at: '2026-01-01' },
    { board_id: 'b', user_id: 'u2', role: 'editor', joined_at: '2026-01-02' },
    { board_id: 'b', user_id: 'u3', role: 'viewer', joined_at: '2026-01-03' },
  ]
  const owner  = mk2('m1', 'Ada',   'u1')
  const editor = mk2('m2', 'Sam',   'u2')
  const viewer = mk2('m3', 'Kai',   'u3')
  const gone   = mk2('m4', 'Bo',    'u9')   // had an account, no longer on the board
  const legacy = mk2('m5', 'Ghost', null)   // pre-003 invented person

  ok('owner is active',  memberAccess(owner, access)  === 'active')
  ok('editor is active', memberAccess(editor, access) === 'active')
  ok('viewer is active', memberAccess(viewer, access) === 'active')
  ok('removed member is revoked', memberAccess(gone, access) === 'revoked')
  ok('unlinked member is revoked', memberAccess(legacy, access) === 'revoked')
  ok('empty access list revokes everyone', memberAccess(owner, []) === 'revoked')

  ok('role reads through', memberRole(owner, access) === 'owner')
  ok('viewer role reads through', memberRole(viewer, access) === 'viewer')
  ok('no role once removed', memberRole(gone, access) === null)
  ok('no role when unlinked', memberRole(legacy, access) === null)

  // Sorting: people still on the board first, then alphabetical inside each group.
  const sorted = [gone, viewer, legacy, owner, editor].sort(byAccessThenName(access))
  ok('active members sort first',
     sorted.slice(0, 3).every(m => memberAccess(m, access) === 'active'),
     sorted.map(m => m.name).join(','))
  ok('alphabetical within active',
     sorted.slice(0, 3).map(m => m.name).join(',') === 'Ada,Kai,Sam',
     sorted.map(m => m.name).join(','))
  ok('revoked grouped at the end',
     sorted.slice(3).every(m => memberAccess(m, access) === 'revoked'),
     sorted.map(m => m.name).join(','))
  ok('nothing lost in the sort', sorted.length === 5)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exitCode = 1
