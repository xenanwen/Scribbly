import { arrayMove } from '@dnd-kit/sortable'
import { positionBetween, byPosition, needsRebalance, rebalance } from '../src/lib/board'
import { STATUSES } from '../src/lib/types'
import type { Task, Status } from '../src/lib/types'

let pass = 0, fail = 0
const ok = (n: string, c: boolean, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const mk = (id: string, status: Status, position: number): Task => ({
  id, title: id, description: null, status, priority: 'normal', due_date: null, position,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  assignee_ids: [], label_ids: [],
})
const isStatus = (s: string): s is Status => (STATUSES as readonly string[]).includes(s)
const order = (all: Task[], s: Status) => all.filter(t => t.status === s).sort(byPosition).map(t => t.id).join(',')

/* Faithful replica of Board.tsx handleDragOver + handleDragEnd, including the
   draft-is-authoritative rule. `hovers` is the sequence of ids the pointer
   passes over; the last one is where the user releases. */
function drag(all: Task[], activeId: string, hovers: string[]) {
  let draft: Task[] | null = null
  const containerOf = (id: string, list: Task[]): Status | null =>
    isStatus(id) ? id : (list.find(t => t.id === id)?.status ?? null)

  for (const overId of hovers) {
    if (overId === activeId) continue
    const list = draft ?? all
    const current = list.find(t => t.id === activeId)
    if (!current) continue
    const to = containerOf(overId, list)
    if (!to) continue
    if (to === current.status && draft === null) continue
    const target = list.filter(t => t.status === to && t.id !== activeId).sort(byPosition)
    const idx = isStatus(overId) ? target.length : target.findIndex(t => t.id === overId)
    const insertAt = idx < 0 ? target.length : idx
    const provisional = positionBetween(target[insertAt - 1], target[insertAt])
    draft = list.map(t => (t.id === activeId ? { ...t, status: to, position: provisional } : t))
  }

  const overId = hovers[hovers.length - 1]

  if (draft) {
    const moved = draft.find(t => t.id === activeId)!
    const col = draft.filter(t => t.status === moved.status).sort(byPosition)
    const at = col.findIndex(t => t.id === activeId)
    return { preview: draft, result: draft, status: moved.status, position: moved.position,
             before: col[at - 1], after: col[at + 1] }
  }

  const to = containerOf(overId, all)!
  const column = all.filter(t => t.status === to).sort(byPosition)
  const oldIndex = column.findIndex(t => t.id === activeId)
  let newIndex = isStatus(overId) ? column.length - 1 : column.findIndex(t => t.id === overId)
  if (newIndex < 0) newIndex = column.length - 1
  const reordered = arrayMove(column, oldIndex, newIndex)
  const position = positionBetween(reordered[newIndex - 1], reordered[newIndex + 1])
  const result = all.map(t => (t.id === activeId ? { ...t, status: to, position } : t))
  return { preview: result, result, status: to, position,
           before: reordered[newIndex - 1], after: reordered[newIndex + 1] }
}

/* ===== cross-column: preview must equal committed result ================== */
{
  const all = [mk('a','todo',1000), mk('b','todo',2000), mk('x','in_progress',1000), mk('y','in_progress',2000)]

  let d = drag(all,'a',['x'])
  ok('lands ABOVE the hovered top card', order(d.result,'in_progress') === 'a,x,y', order(d.result,'in_progress'))
  ok('preview === result', order(d.preview,'in_progress') === order(d.result,'in_progress'))
  ok('left the source column', order(d.result,'todo') === 'b', order(d.result,'todo'))
  ok('status committed', d.status === 'in_progress')

  d = drag(all,'a',['y'])
  ok('lands above hovered 2nd card', order(d.result,'in_progress') === 'x,a,y', order(d.result,'in_progress'))

  d = drag(all,'a',['in_progress'])
  ok('column-body drop appends', order(d.result,'in_progress') === 'x,y,a', order(d.result,'in_progress'))

  d = drag(all,'a',['x','y'])
  ok('multi-hover ends at last hover', order(d.result,'in_progress') === 'x,a,y', order(d.result,'in_progress'))

  d = drag(all,'a',['x','in_progress'])
  ok('hover card then body appends', order(d.result,'in_progress') === 'x,y,a', order(d.result,'in_progress'))

  d = drag(all,'a',['done'])
  ok('into empty column', order(d.result,'done') === 'a', order(d.result,'done'))
  ok('empty-column position finite & positive', Number.isFinite(d.position) && d.position > 0, String(d.position))

  // leave and come back
  d = drag(all,'a',['x','todo'])
  ok('return to home column appends there', order(d.result,'todo') === 'b,a', order(d.result,'todo'))
  d = drag(all,'a',['in_progress','b'])
  ok('return home above b', order(d.result,'todo') === 'a,b', order(d.result,'todo'))
}

/* ===== same-column reordering still uses arrayMove ======================== */
{
  const all = [mk('a','todo',1000), mk('b','todo',2000), mk('c','todo',3000), mk('d','todo',4000)]
  ok('drag last onto 2nd', order(drag(all,'d',['b']).result,'todo') === 'a,d,b,c')
  ok('drag first onto 3rd', order(drag(all,'a',['c']).result,'todo') === 'b,c,a,d')
  ok('adjacent down', order(drag(all,'a',['b']).result,'todo') === 'b,a,c,d')
  ok('adjacent up', order(drag(all,'b',['a']).result,'todo') === 'b,a,c,d')
  ok('same-column body drop appends', order(drag(all,'b',['todo']).result,'todo') === 'a,c,d,b')
  const self = drag(all,'c',['c'])
  ok('drop on self stable', order(self.result,'todo') === 'a,b,c,d' && self.position === 3000)
}

/* ===== hovering own placeholder is ignored =============================== */
{
  const all = [mk('a','todo',1000), mk('x','in_progress',1000)]
  const d = drag(all,'a',['x','a'])
  ok('self-hover does not relocate', order(d.result,'in_progress') === 'a,x', order(d.result,'in_progress'))
}

/* ===== single card / empty board edges =================================== */
{
  ok('single card same column', order(drag([mk('s','todo',1000)],'s',['todo']).result,'todo') === 's')
  ok('single card cross column', order(drag([mk('s','todo',1000)],'s',['done']).result,'done') === 's')
}

/* ===== fractional index exhaustion + rebalance guard ==================== */
{
  // Repeatedly insert a new card just above the same upper neighbour. Each
  // insertion halves the remaining gap, which is the pathological case for
  // fractional indexing.
  const upper = mk('hi','todo',2000)
  let lower = mk('lo','todo',1000)
  let trippedAt = -1
  let collapsedAt = -1

  for (let i = 0; i < 90; i++) {
    if (trippedAt < 0 && needsRebalance(lower, upper)) trippedAt = i
    const p = positionBetween(lower, upper)
    // Collapse = float precision exhausted, the midpoint is no longer strictly
    // between its neighbours. The rebalance guard must fire well before this.
    if (!(p > lower.position && p < upper.position)) { collapsedAt = i; break }
    lower = mk('c' + i, 'todo', p)
  }

  ok('positions do eventually collapse (float reality)', collapsedAt > 0, `collapsedAt=${collapsedAt}`)
  ok('rebalance guard trips before collapse', trippedAt > 0 && trippedAt < collapsedAt,
     `tripped=${trippedAt} collapsed=${collapsedAt}`)
  ok('guard leaves a healthy margin (>10 splits)', collapsedAt - trippedAt > 10,
     `margin=${collapsedAt - trippedAt}`)

  // ...and rebalancing restores usable spacing.
  const tight = [mk('a','todo',1.0000001), mk('b','todo',1.0000002), mk('c','todo',1.0000003)]
  const fixed = rebalance(tight)
  ok('rebalance restores clean integers', JSON.stringify(fixed.map(f => f.position)) === '[1000,2000,3000]')
  ok('rebalance preserves order', fixed.map(f => f.id).join(',') === 'a,b,c')
  ok('gap is roomy again', !needsRebalance(mk('a','todo',1000), mk('b','todo',2000)))
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exitCode = 1
