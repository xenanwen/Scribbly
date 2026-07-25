import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { identityFromSession } from '../lib/auth'
import type { Identity } from '../lib/auth'

/* ==========================================================================
   useSession — the single source of truth for "who is using this app".

   Everything flows through supabase.auth.onAuthStateChange rather than being
   set imperatively by whichever form was submitted. That matters because a
   session can change without any UI action:

     * the confirmation link in an email returns with tokens in the URL
       (supabase-js swaps them for a session, then fires SIGNED_IN)
     * a token refresh
     * signing out in another tab

   Listening in one place means all of those land on the same code path.
   ========================================================================== */

export type SessionStatus = 'booting' | 'signedOut' | 'signedIn'

export interface SessionState {
  status: SessionStatus
  identity: Identity | null
}

export function useSession(enabled: boolean): SessionState {
  const [state, setState] = useState<SessionState>({
    status: enabled ? 'booting' : 'signedOut',
    identity: null,
  })

  useEffect(() => {
    if (!enabled) return
    let alive = true

    const apply = (session: Parameters<typeof identityFromSession>[0]) => {
      if (!alive) return
      const identity = identityFromSession(session)
      setState({ status: identity ? 'signedIn' : 'signedOut', identity })
    }

    /* onAuthStateChange fires INITIAL_SESSION immediately on subscribe, so this
       covers the first read too. getSession() is still called below as a
       belt-and-braces fallback in case that event is missed. */
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      apply(session)
    })

    void supabase.auth.getSession().then(({ data }) => {
      // Don't overwrite a decision the listener already made.
      setState((prev) => {
        if (prev.status !== 'booting') return prev
        const identity = identityFromSession(data.session)
        return { status: identity ? 'signedIn' : 'signedOut', identity }
      })
    })

    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [enabled])

  return state
}
