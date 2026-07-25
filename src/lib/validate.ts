/* ==========================================================================
   Form validation. Pure functions, no React, no network — so they're covered
   by `npm test` rather than by clicking through the UI.

   Each returns an error string, or null when the value is acceptable.
   ========================================================================== */

/** Deliberately permissive. The only authority on whether an address exists is
 *  the confirmation email, so the job here is to catch typos (missing @, no
 *  dot in the domain, stray spaces) — not to police the RFC. */
export function validateEmail(value: string): string | null {
  const email = value.trim()
  if (!email) return 'Enter your email address.'
  if (/\s/.test(email)) return 'Email addresses cannot contain spaces.'

  const at = email.indexOf('@')
  if (at < 1) return 'That needs an @ — for example you@example.com'
  if (email.indexOf('@', at + 1) !== -1) return 'That has more than one @.'

  const domain = email.slice(at + 1)
  if (!domain.includes('.')) return 'The part after @ needs a dot, like example.com'
  if (domain.startsWith('.') || domain.endsWith('.')) return 'That domain looks incomplete.'
  if (domain.includes('..')) return 'That domain has a double dot.'
  if (email.length > 254) return 'That address is too long.'
  return null
}

/** Supabase's own floor is 6 characters; 8 is a more defensible minimum and
 *  still low enough not to be annoying. */
export const MIN_PASSWORD = 8

export function validatePassword(value: string): string | null {
  if (!value) return 'Choose a password.'
  if (value.length < MIN_PASSWORD) {
    return `Use at least ${MIN_PASSWORD} characters — that's ${MIN_PASSWORD - value.length} more.`
  }
  if (value.length > 72) {
    // bcrypt silently truncates past 72 bytes, so refuse rather than mislead
    return 'That password is too long — 72 characters maximum.'
  }
  if (!value.trim()) return 'A password cannot be only spaces.'
  return null
}

export function validatePasswordConfirmation(
  password: string,
  confirmation: string,
): string | null {
  if (!confirmation) return 'Type your password again to confirm it.'
  if (password !== confirmation) return "Those two passwords don't match."
  return null
}

/** Rough, honest strength read used only to label the meter. Length dominates
 *  because it genuinely matters more than character-class variety. */
export type Strength = 'weak' | 'fair' | 'good' | 'strong'

export function passwordStrength(value: string): Strength {
  if (value.length < MIN_PASSWORD) return 'weak'

  let variety = 0
  if (/[a-z]/.test(value)) variety += 1
  if (/[A-Z]/.test(value)) variety += 1
  if (/[0-9]/.test(value)) variety += 1
  if (/[^a-zA-Z0-9]/.test(value)) variety += 1

  if (value.length >= 16 && variety >= 2) return 'strong'
  if (value.length >= 12 && variety >= 2) return 'good'
  if (value.length >= 10 || variety >= 3) return 'fair'
  return 'weak'
}
