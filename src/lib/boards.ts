import { supabase } from './supabase'
import type { Board, BoardMember, Invite, Role } from './types'

/* ==========================================================================
   Boards and sharing.

   Access control lives entirely in Postgres — every call here is an ordinary
   query that RLS narrows to boards the caller belongs to. The three operations
   that can't work that way go through RPCs:

     create_board          — board + owner row in one transaction, so a failure
                             can't leave a board nobody can reach
     create_board_invite   — token generated server-side, and it refuses guests
     redeem_board_invite   — the joiner isn't a member yet, so under normal
                             policies they can neither read the invite nor add
                             themselves; SECURITY DEFINER is the only way in
   ========================================================================== */

/** Shape of the board_members → boards join Postgres returns. */
interface MembershipRow {
  role: Role
  boards: {
    id: string
    name: string
    owner_id: string
    created_at: string
  } | null
}

/** Every board the caller can reach, newest last. */
export async function listBoards(): Promise<Board[]> {
  const { data, error } = await supabase
    .from('board_members')
    .select('role, boards(id, name, owner_id, created_at)')
    .order('joined_at', { ascending: true })
  if (error) throw error

  return ((data ?? []) as unknown as MembershipRow[])
    .filter((row): row is MembershipRow & { boards: NonNullable<MembershipRow['boards']> } =>
      row.boards !== null,
    )
    .map((row) => ({ ...row.boards, role: row.role }))
}

export async function createBoard(name: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_board', { p_name: name })
  if (error) throw error
  return data as string
}

export async function renameBoard(boardId: string, name: string): Promise<void> {
  const { error } = await supabase.from('boards').update({ name }).eq('id', boardId)
  if (error) throw error
}

/** Owner only — cascades to every task, label, comment and invite. */
export async function deleteBoard(boardId: string): Promise<void> {
  const { error } = await supabase.from('boards').delete().eq('id', boardId)
  if (error) throw error
}

/** Remove yourself from a board someone else owns. */
export async function leaveBoard(boardId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('board_members')
    .delete()
    .eq('board_id', boardId)
    .eq('user_id', userId)
  if (error) throw error
}

/* ---- People with access -------------------------------------------------- */

export async function listBoardMembers(boardId: string): Promise<BoardMember[]> {
  const { data, error } = await supabase
    .from('board_members')
    .select('*')
    .eq('board_id', boardId)
    .order('joined_at')
  if (error) throw error
  return (data ?? []) as BoardMember[]
}

export async function setMemberRole(
  boardId: string,
  userId: string,
  role: Exclude<Role, 'owner'>,
): Promise<void> {
  const { error } = await supabase
    .from('board_members')
    .update({ role })
    .eq('board_id', boardId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function removeBoardMember(boardId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('board_members')
    .delete()
    .eq('board_id', boardId)
    .eq('user_id', userId)
  if (error) throw error
}

/* ---- Invite links -------------------------------------------------------- */

export async function listInvites(boardId: string): Promise<Invite[]> {
  const { data, error } = await supabase
    .from('board_invites')
    .select('*')
    .eq('board_id', boardId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Invite[]
}

export interface NewInvite {
  role?: Exclude<Role, 'owner'>
  /** Postgres interval, or null for a link that never expires. */
  expiresIn?: string | null
  maxUses?: number | null
}

export async function createInvite(
  boardId: string,
  { role = 'editor', expiresIn = '14 days', maxUses = null }: NewInvite = {},
): Promise<string> {
  const { data, error } = await supabase.rpc('create_board_invite', {
    p_board: boardId,
    p_role: role,
    p_expires_in: expiresIn,
    p_max_uses: maxUses,
  })
  if (error) throw error
  return data as string
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const { error } = await supabase
    .from('board_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', inviteId)
  if (error) throw error
}

/** Returns the board id that was joined. */
export async function redeemInvite(token: string): Promise<string> {
  const { data, error } = await supabase.rpc('redeem_board_invite', { p_token: token })
  if (error) throw error
  return data as string
}

/* ---- Invite URLs --------------------------------------------------------- */

const INVITE_PARAM = 'invite'

export function inviteUrl(token: string): string {
  const url = new URL(window.location.href)
  url.hash = ''
  url.search = `?${INVITE_PARAM}=${encodeURIComponent(token)}`
  return url.toString()
}

/** Pull a token out of the current URL, if there is one. */
export function readInviteToken(): string | null {
  const token = new URLSearchParams(window.location.search).get(INVITE_PARAM)
  return token && token.trim() ? token.trim() : null
}

/** Strip the token from the address bar once it's been used, so a reload
 *  doesn't try to redeem it again and the secret stops sitting in history. */
export function clearInviteToken(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete(INVITE_PARAM)
  window.history.replaceState({}, '', url.pathname + (url.search || '') + url.hash)
}

/* ---- Local preference ---------------------------------------------------- */

const LAST_BOARD_KEY = 'scribbly-last-board'

export function rememberBoard(boardId: string): void {
  try {
    localStorage.setItem(LAST_BOARD_KEY, boardId)
  } catch {
    // Private browsing can refuse writes. Losing the preference is harmless.
  }
}

export function recallBoard(): string | null {
  try {
    return localStorage.getItem(LAST_BOARD_KEY)
  } catch {
    return null
  }
}
