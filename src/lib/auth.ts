import { supabase } from './supabase'

/* ==========================================================================
   Guest sessions.

   Requirement: no email, no password — a visitor lands on the board and it just
   works, while still getting a real auth.uid() so RLS has something to key on.
   Supabase anonymous sign-in does exactly that: it mints a normal JWT with
   role `authenticated` and `is_anonymous: true`.

   The session is persisted to localStorage by the client, so a refresh keeps
   the same user id — and therefore the same tasks.
   ========================================================================== */

export interface GuestSession {
  userId: string
  isNew: boolean
}

/* React 18 StrictMode mounts effects twice in development. Without a guard,
   that fires signInAnonymously() twice and creates two orphaned guest users
   (the second one winning, so the first user's seeded tasks vanish). Memoising
   the in-flight promise at module scope makes the call idempotent. */
let inFlight: Promise<GuestSession> | null = null

export function ensureGuestSession(): Promise<GuestSession> {
  if (!inFlight) {
    inFlight = start().catch((err) => {
      inFlight = null // let the user retry after a failure
      throw err
    })
  }
  return inFlight
}

async function start(): Promise<GuestSession> {
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

/** First-run content. Non-fatal: an empty board is a perfectly fine fallback,
 *  so a seeding failure is logged rather than shown as an error. */
export async function seedStarterBoard(): Promise<void> {
  const { error } = await supabase.rpc('seed_starter_board')
  if (error) {
    console.warn('[paperboard] could not seed the starter board:', error.message)
  }
}

/** Wipe the local session and hand out a brand-new guest identity. This is how
 *  you demonstrate isolation: two guest ids, two separate boards. */
export async function resetGuestSession(): Promise<void> {
  inFlight = null
  await supabase.auth.signOut()
}
