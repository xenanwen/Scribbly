import { createClient } from '@supabase/supabase-js'

/* ==========================================================================
   The one and only Supabase client.

   SECURITY: both values below are *public by design*. The anon key is a signed
   JWT that says "I am an anonymous visitor"; it grants no privileges on its
   own. Every permission in this app comes from the Row Level Security policies
   in supabase/schema.sql. The service_role key — which *does* bypass RLS —
   must never appear in this repo, in any VITE_* variable, or in the browser.
   Anything prefixed VITE_ is inlined into the JS bundle and is world-readable.
   ========================================================================== */

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** True when env vars are present. The UI shows a setup screen when false,
 *  rather than crashing with an opaque error. */
export const isConfigured = Boolean(url && anonKey)

if (import.meta.env.DEV && !isConfigured) {
  console.warn(
    '[paperboard] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.\n' +
      'Copy .env.local.example to .env.local, fill it in, then restart `npm run dev`.',
  )
}

// A guard against the single most expensive mistake possible here.
if (anonKey && anonKey.includes('service_role')) {
  throw new Error(
    'That looks like a service_role key. Never put it in a frontend env var — ' +
      'it bypasses Row Level Security. Use the anon / publishable key.',
  )
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing', {
  auth: {
    // Persist the guest session so a refresh doesn't strand the user's tasks
    // behind a brand-new anonymous user id.
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'paperboard-auth',
  },
})

/* --------------------------------------------------------------------------
   Error translation. Supabase/Postgres errors are precise but unfriendly;
   these are the ones a user of this app can actually trigger.
   -------------------------------------------------------------------------- */
export function friendlyError(err: unknown): string {
  if (!err) return 'Something went wrong.'

  const raw =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : ((err as { message?: string }).message ?? JSON.stringify(err))

  const code = (err as { code?: string }).code
  const lower = raw.toLowerCase()

  if (lower.includes('anonymous sign-ins are disabled')) {
    return 'Anonymous sign-in is turned off for this Supabase project. Enable it under Authentication → Sign In / Providers → Anonymous sign-ins.'
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return 'Cannot reach Supabase. Check your connection and that VITE_SUPABASE_URL is correct.'
  }
  // 42P01 undefined_table
  if (code === '42P01' || lower.includes('does not exist')) {
    return 'A table is missing. Run supabase/schema.sql in the Supabase SQL editor.'
  }
  // 42501 insufficient_privilege — almost always an RLS policy rejection
  if (code === '42501' || lower.includes('row-level security')) {
    return 'The database refused that write (Row Level Security). Your guest session may have expired — try reloading.'
  }
  if (code === '23514') {
    return 'That value is not allowed. Titles cannot be empty and must be under 200 characters.'
  }
  if (code === '23505' || lower.includes('duplicate key')) {
    return 'That already exists — pick a different name.'
  }
  if (lower.includes('jwt') || lower.includes('token is expired')) {
    return 'Your session expired. Reload the page to start a new guest session.'
  }
  return raw
}
