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

const rawUrl = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Normalise the project URL.
 *
 * supabase-js wants the bare origin — `https://<ref>.supabase.co` — and appends
 * `/rest/v1`, `/auth/v1` etc. itself. But the dashboard displays some endpoints
 * with those paths already attached, so pasting one in is an easy mistake, and
 * the resulting `/rest/v1/rest/v1/...` requests fail with nothing but a generic
 * network error. Strip any path rather than let that happen.
 */
function normaliseUrl(value: string | undefined): string | undefined {
  if (!value) return value
  const trimmed = value.trim().replace(/\/+$/, '')
  try {
    const parsed = new URL(trimmed)
    if (parsed.pathname !== '/' && parsed.pathname !== '') {
      if (import.meta.env.DEV) {
        console.warn(
          `[paperboard] VITE_SUPABASE_URL should be just the project origin.\n` +
            `  got:      ${trimmed}\n` +
            `  using:    ${parsed.origin}\n` +
            `Drop the "${parsed.pathname}" part in .env.local to silence this.`,
        )
      }
      return parsed.origin
    }
    return parsed.origin
  } catch {
    return trimmed // let the client surface a clearer error than we can
  }
}

const url = normaliseUrl(rawUrl)

/** True when env vars are present. The UI shows a setup screen when false,
 *  rather than crashing with an opaque error. */
export const isConfigured = Boolean(url && anonKey)

if (import.meta.env.DEV && !isConfigured) {
  console.warn(
    '[paperboard] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.\n' +
      'Copy .env.local.example to .env.local, fill it in, then restart `npm run dev`.',
  )
}

/* A guard against the single most expensive mistake possible here. Covers both
   the legacy JWT-style service key and the current `sb_secret_` format. */
if (anonKey && (anonKey.includes('service_role') || anonKey.startsWith('sb_secret_'))) {
  throw new Error(
    'That looks like a secret / service_role key. Never put it in a frontend env ' +
      'var — it bypasses Row Level Security. Use the anon (sb_publishable_…) key.',
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
  /* Browsers word network failures differently and none of them say anything
     useful: Chrome "Failed to fetch", Safari "Load failed", Firefox
     "NetworkError". By far the most common cause here is a malformed project
     URL, so say so rather than blaming the connection. */
  if (
    lower.includes('failed to fetch') ||
    lower === 'load failed' ||
    lower.includes('networkerror') ||
    lower.includes('err_name_not_resolved')
  ) {
    return (
      'Cannot reach Supabase. Check VITE_SUPABASE_URL in .env.local — it should be ' +
      'just https://<your-ref>.supabase.co with no /rest/v1 or trailing path. ' +
      'Restart the dev server after changing it.'
    )
  }
  /* 42883 undefined_function. Checked BEFORE the table case, which matches on
     the bare words "does not exist" and would otherwise claim a table is
     missing when the truth is a function the database cannot resolve — usually
     one that lives in a schema outside the caller's search_path. */
  if (
    code === '42883' ||
    code === 'PGRST202' ||
    (lower.includes('function') && lower.includes('does not exist')) ||
    lower.includes('in the schema cache')
  ) {
    return (
      'The database could not find a function it needs. Run the numbered ' +
      'migrations in supabase/ that you have not run yet — they go in order ' +
      'after schema.sql.'
    )
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