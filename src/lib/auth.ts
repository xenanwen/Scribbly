import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'

/* ==========================================================================
   Authentication.

   Three ways in, all landing on the same Row Level Security model — every
   policy keys on auth.uid(), which is a real uuid whether you arrived as a
   guest or with a password. That's why adding accounts required no schema
   change at all.

     1. Guest      — signInAnonymously(). No email, no password. The session
                     lives in this browser's localStorage.
     2. Sign up    — email + password. Email confirmation is REQUIRED, so no
                     session exists until the link in the email is clicked.
     3. Log in     — email + password for a confirmed account.

   Plus one conversion path: a guest can turn their existing board into a
   permanent account without losing anything, because linking an email to an
   anonymous user keeps the same auth.uid().
   ========================================================================== */

export interface Identity {
  userId: string
  email: string | null
  /** Anonymous session: no credentials, tied to this browser only. */
  isGuest: boolean
  /** Guest→account upgrade started but the password isn't set yet. */
  upgradePending: boolean
}

export function identityFromUser(user: User): Identity {
  return {
    userId: user.id,
    email: user.email ?? null,
    // is_anonymous is the authoritative claim; fall back to "has no email" for
    // safety if an older gotrue build omits it.
    isGuest: user.is_anonymous ?? !user.email,
    upgradePending: user.user_metadata?.upgrade_pending === true,
  }
}

export function identityFromSession(session: Session | null): Identity | null {
  return session?.user ? identityFromUser(session.user) : null
}

/** Where Supabase should send people after they click a confirmation link. */
function redirectTo(): string {
  return `${window.location.origin}${window.location.pathname}`
}

/* --------------------------------------------------------------------------
   1. Guest sessions
   -------------------------------------------------------------------------- */

export interface GuestResult {
  userId: string
  isNew: boolean
}

/* React 18 StrictMode mounts effects twice in development. Without a guard that
   fires signInAnonymously() twice and creates two orphaned guest users — the
   second winning, so the first one's seeded tasks vanish. Memoising the
   in-flight promise makes the call idempotent. */
let guestInFlight: Promise<GuestResult> | null = null

export function continueAsGuest(): Promise<GuestResult> {
  if (!guestInFlight) {
    guestInFlight = createGuest().catch((err) => {
      guestInFlight = null // allow a retry after failure
      throw err
    })
  }
  return guestInFlight
}

async function createGuest(): Promise<GuestResult> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error

  if (data.session?.user) {
    return { userId: data.session.user.id, isNew: false }
  }

  const created = await supabase.auth.signInAnonymously()
  if (created.error) throw created.error
  if (!created.data.user) throw new Error('Supabase returned no user for the guest session.')

  return { userId: created.data.user.id, isNew: true }
}

/* --------------------------------------------------------------------------
   2. Sign up
   -------------------------------------------------------------------------- */

export interface SignUpResult {
  /** True when Supabase created the user but withheld a session pending
   *  email confirmation — which, with confirmations on, is the normal path. */
  needsConfirmation: boolean
}

export async function signUp(email: string, password: string): Promise<SignUpResult> {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { emailRedirectTo: redirectTo() },
  })
  if (error) throw error

  /* Supabase deliberately does not reveal whether an address is already
     registered — it returns a user-shaped response either way. So we can't (and
     shouldn't) say "that email is taken"; "check your inbox" is correct for
     both cases and avoids leaking who has an account. */
  return { needsConfirmation: !data.session }
}

export async function resendConfirmation(email: string): Promise<void> {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.trim(),
    options: { emailRedirectTo: redirectTo() },
  })
  if (error) throw error
}

/* --------------------------------------------------------------------------
   3. Log in / out
   -------------------------------------------------------------------------- */

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  })
  if (error) throw error
}

export async function signOut(): Promise<void> {
  guestInFlight = null
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

/* --------------------------------------------------------------------------
   4. Guest → account, keeping the board
   -------------------------------------------------------------------------- */

/**
 * Step one: attach an email to the anonymous user. Supabase sends a
 * confirmation link and does NOT apply the address until it's clicked.
 *
 * A password can't be set yet — Supabase requires a verified email or phone
 * before an anonymous user can have one. So we flag the account in metadata and
 * finish the job when they come back. Notably we never store the password
 * anywhere in the meantime.
 */
export async function startUpgrade(email: string): Promise<void> {
  const { error } = await supabase.auth.updateUser(
    { email: email.trim(), data: { upgrade_pending: true } },
    { emailRedirectTo: redirectTo() },
  )
  if (error) throw error
}

/** Step two, after the emailed link is clicked: set the password and clear the
 *  flag. The uuid never changed, so every task, label and comment is still
 *  theirs — no data migration involved. */
export async function finishUpgrade(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({
    password,
    data: { upgrade_pending: false },
  })
  if (error) throw error
}

/** Escape hatch if someone starts an upgrade and changes their mind. */
export async function cancelUpgrade(): Promise<void> {
  const { error } = await supabase.auth.updateUser({ data: { upgrade_pending: false } })
  if (error) throw error
}

/* --------------------------------------------------------------------------
   5. First-run content
   -------------------------------------------------------------------------- */

/** Non-fatal: an empty board is a fine fallback, so a seeding failure is logged
 *  rather than shown as an error. */
export async function seedStarterBoard(): Promise<void> {
  const { error } = await supabase.rpc('seed_starter_board')
  if (error) {
    console.warn('[paperboard] could not seed the starter board:', error.message)
  }
}

/** Abandon this guest identity and hand out a fresh one. How you demonstrate
 *  isolation: two guest ids, two entirely separate boards. */
export async function resetGuestSession(): Promise<void> {
  guestInFlight = null
  await supabase.auth.signOut()
}
