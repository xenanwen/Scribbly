import { useEffect, useRef, useState } from 'react'
import { Button } from './Primitives'
import { MIN_PASSWORD, passwordStrength, validateEmail, validatePassword } from '../lib/validate'

/* ==========================================================================
   The opening screen — the inside cover of the notebook.

   Three ways in, and the copy is honest about what each one costs you:

     * Log in            — you already have an account
     * Create an account — email + password, confirmation required
     * Continue as guest  — instant, but tied to this browser

   The guest option is deliberately not hidden away as a "skip" link. It's the
   fastest route to seeing whether the app is any good, and for this project
   it's also the flow the brief cares most about.
   ========================================================================== */

type Mode = 'choose' | 'login' | 'signup' | 'sent'

interface Props {
  onContinueAsGuest: () => Promise<void>
  onLogin: (email: string, password: string) => Promise<void>
  onSignUp: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>
  onResend: (email: string) => Promise<void>
}

export function HomeScreen({ onContinueAsGuest, onLogin, onSignUp, onResend }: Props) {
  const [mode, setMode] = useState<Mode>('choose')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'guest' | 'form' | 'resend'>(null)
  const [resent, setResent] = useState(false)

  const firstField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (mode === 'login' || mode === 'signup') firstField.current?.focus()
  }, [mode])

  const goTo = (next: Mode) => {
    setMode(next)
    setFormError(null)
    setEmailError(null)
    setPasswordError(null)
  }

  const guest = async () => {
    setBusy('guest')
    setFormError(null)
    try {
      await onContinueAsGuest()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const submit = async () => {
    const eErr = validateEmail(email)
    // On login, don't nag about password rules — the account may predate them.
    const pErr = mode === 'signup' ? validatePassword(password) : password ? null : 'Enter your password.'
    setEmailError(eErr)
    setPasswordError(pErr)
    if (eErr || pErr) return

    setBusy('form')
    setFormError(null)
    try {
      if (mode === 'login') {
        await onLogin(email, password)
        // On success the session listener swaps this screen for the board.
      } else {
        const { needsConfirmation } = await onSignUp(email, password)
        if (needsConfirmation) {
          setMode('sent')
        }
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const resend = async () => {
    setBusy('resend')
    setFormError(null)
    try {
      await onResend(email)
      setResent(true)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="cover">
      <div className="cover__sheet">
        <header className="cover__head">
          <h1 className="cover__title">Scribbly</h1>
          <p className="cover__tagline">everything you owe the week, on one page</p>
        </header>

        {/* The "this notebook belongs to" line from a school exercise book.
            Decorative, and it sets the theme before you read a single control. */}
        <div className="nameplate" aria-hidden="true">
          <span className="nameplate__label">This notebook belongs to</span>
          <span className="nameplate__rule" />
        </div>

        {mode === 'choose' && (
          <div className="cover__choices">
            <button className="choice" onClick={() => goTo('login')}>
              <span className="choice__mark">1</span>
              <span className="choice__body">
                <span className="choice__title">Log in</span>
                <span className="choice__sub">You've been here before</span>
              </span>
              <Chevron />
            </button>

            <button className="choice" onClick={() => goTo('signup')}>
              <span className="choice__mark">2</span>
              <span className="choice__body">
                <span className="choice__title">Create an account</span>
                <span className="choice__sub">Keep your board on any device</span>
              </span>
              <Chevron />
            </button>

            <button className="choice choice--guest" onClick={guest} disabled={busy !== null}>
              <span className="choice__mark">3</span>
              <span className="choice__body">
                <span className="choice__title">
                  {busy === 'guest' ? 'Opening your board…' : 'Continue as a guest'}
                </span>
                <span className="choice__sub">No email, no password — straight in</span>
              </span>
              {busy === 'guest' ? <Spinner /> : <Chevron />}
            </button>

            {formError && <p className="cover__error">{formError}</p>}

            <p className="cover__fineprint">
              A guest board is private to you — it gets its own id and Row Level Security makes it
              unreadable to anyone else. It lives in <strong>this browser</strong> though, so
              clearing site data or switching device starts a fresh one. You can turn a guest board
              into a full account later without losing anything.
            </p>
          </div>
        )}

        {(mode === 'login' || mode === 'signup') && (
          <form
            className="cover__form"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <h2 className="cover__formTitle">
              {mode === 'login' ? 'Log in' : 'Create an account'}
            </h2>

            <div className="field">
              <label className="field__label" htmlFor="auth-email">
                Email
              </label>
              <input
                id="auth-email"
                ref={firstField}
                className={`input input--lg${emailError ? ' input--invalid' : ''}`}
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (emailError) setEmailError(null)
                }}
                onBlur={() => email && setEmailError(validateEmail(email))}
                aria-invalid={Boolean(emailError)}
                aria-describedby={emailError ? 'auth-email-err' : undefined}
              />
              {emailError && (
                <p className="field__error" id="auth-email-err">
                  {emailError}
                </p>
              )}
            </div>

            <div className="field">
              <label className="field__label" htmlFor="auth-password">
                Password
                {mode === 'signup' && (
                  <span className="field__optional">at least {MIN_PASSWORD} characters</span>
                )}
              </label>
              <input
                id="auth-password"
                className={`input input--lg${passwordError ? ' input--invalid' : ''}`}
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (passwordError) setPasswordError(null)
                }}
                aria-invalid={Boolean(passwordError)}
                aria-describedby={passwordError ? 'auth-password-err' : undefined}
              />
              {mode === 'signup' && password.length > 0 && (
                <StrengthMeter value={password} />
              )}
              {passwordError && (
                <p className="field__error" id="auth-password-err">
                  {passwordError}
                </p>
              )}
            </div>

            {formError && <p className="cover__error">{formError}</p>}

            <div className="cover__actions">
              <Button variant="primary" type="submit" disabled={busy === 'form'}>
                {busy === 'form'
                  ? 'Just a moment…'
                  : mode === 'login'
                    ? 'Log in'
                    : 'Create account'}
              </Button>
              <button type="button" className="link-btn" onClick={() => goTo('choose')}>
                Back
              </button>
            </div>

            <p className="cover__swap">
              {mode === 'login' ? (
                <>
                  No account yet?{' '}
                  <button type="button" className="link-btn" onClick={() => goTo('signup')}>
                    Create one
                  </button>
                </>
              ) : (
                <>
                  Already have one?{' '}
                  <button type="button" className="link-btn" onClick={() => goTo('login')}>
                    Log in
                  </button>
                </>
              )}
            </p>
          </form>
        )}

        {mode === 'sent' && (
          <div className="cover__sent">
            <EnvelopeDoodle />
            <h2 className="cover__formTitle">Check your inbox</h2>
            <p className="cover__sentText">
              We sent a confirmation link to <strong>{email}</strong>. Click it and you'll land back
              here, logged in.
            </p>
            <p className="cover__fineprint">
              Nothing arrived? Look in spam. The free Supabase tier throttles outgoing email, so it
              can take a minute or two.
            </p>

            {formError && <p className="cover__error">{formError}</p>}

            <div className="cover__actions">
              <Button variant="ghost" onClick={resend} disabled={busy === 'resend' || resent}>
                {resent ? 'Sent again' : busy === 'resend' ? 'Sending…' : 'Resend the email'}
              </Button>
              <button type="button" className="link-btn" onClick={() => goTo('choose')}>
                Back
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="cover__footer">
        Built with React, TypeScript and Supabase · your data is protected by Row Level Security
      </p>
    </main>
  )
}

/* -------------------------------------------------------------------------- */

function StrengthMeter({ value }: { value: string }) {
  const strength = passwordStrength(value)
  const filled = { weak: 1, fair: 2, good: 3, strong: 4 }[strength]
  return (
    <div className={`strength strength--${strength}`}>
      <span className="strength__bars" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <i key={i} className={i < filled ? 'on' : ''} />
        ))}
      </span>
      <span className="strength__label">{strength}</span>
    </div>
  )
}

function Chevron() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true" className="choice__chev">
      <path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true" className="spinner">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.8" opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function EnvelopeDoodle() {
  return (
    <svg viewBox="0 0 64 48" width="56" height="42" fill="none" aria-hidden="true" className="doodle">
      <rect x="6" y="8" width="52" height="34" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 11l26 18 26-18" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}
