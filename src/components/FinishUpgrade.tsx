import { useState } from 'react'
import { Button } from './Primitives'
import { MIN_PASSWORD, passwordStrength, validatePassword, validatePasswordConfirmation } from '../lib/validate'

/* ==========================================================================
   Step two of turning a guest board into an account.

   Shown when the user has confirmed an email address but has no password yet —
   `user_metadata.upgrade_pending` is still true. Supabase won't accept a
   password on an anonymous user until the email is verified, which is why this
   is a separate screen rather than one form.

   Their board is already safe at this point: the email was linked to the same
   auth.uid(), so no rows moved anywhere.
   ========================================================================== */

interface Props {
  email: string
  onFinish: (password: string) => Promise<void>
  onCancel: () => Promise<void>
}

export function FinishUpgrade({ email, onFinish, onCancel }: Props) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'save' | 'cancel'>(null)

  const submit = async () => {
    const p = validatePassword(password)
    const c = validatePasswordConfirmation(password, confirmation)
    setPwError(p)
    setConfirmError(c)
    if (p || c) return

    setBusy('save')
    setFormError(null)
    try {
      await onFinish(password)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const skip = async () => {
    setBusy('cancel')
    setFormError(null)
    try {
      await onCancel()
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
          <h1 className="cover__title">Almost done</h1>
          <p className="cover__tagline">one password and this board is yours for good</p>
        </header>

        <p className="cover__sentText">
          <strong>{email}</strong> is confirmed. Set a password and you'll be able to log in from
          any device. Everything already on your board comes with you — nothing moves, because your
          account kept the same id.
        </p>

        <form
          className="cover__form"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="field">
            <label className="field__label" htmlFor="up-password">
              New password
              <span className="field__optional">at least {MIN_PASSWORD} characters</span>
            </label>
            <input
              id="up-password"
              className={`input input--lg${pwError ? ' input--invalid' : ''}`}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (pwError) setPwError(null)
              }}
              aria-invalid={Boolean(pwError)}
            />
            {password.length > 0 && <StrengthMeter value={password} />}
            {pwError && <p className="field__error">{pwError}</p>}
          </div>

          <div className="field">
            <label className="field__label" htmlFor="up-confirm">
              Confirm password
            </label>
            <input
              id="up-confirm"
              className={`input input--lg${confirmError ? ' input--invalid' : ''}`}
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(e) => {
                setConfirmation(e.target.value)
                if (confirmError) setConfirmError(null)
              }}
              aria-invalid={Boolean(confirmError)}
            />
            {confirmError && <p className="field__error">{confirmError}</p>}
          </div>

          {formError && <p className="cover__error">{formError}</p>}

          <div className="cover__actions">
            <Button variant="primary" type="submit" disabled={busy === 'save'}>
              {busy === 'save' ? 'Saving…' : 'Save password'}
            </Button>
            <button type="button" className="link-btn" onClick={() => void skip()} disabled={busy !== null}>
              {busy === 'cancel' ? 'One moment…' : 'Skip for now'}
            </button>
          </div>

          <p className="cover__fineprint">
            Skipping keeps you on this board in this browser, but without a password you won't be
            able to log in elsewhere. You can set one later from the Team panel.
          </p>
        </form>
      </div>
    </main>
  )
}

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
