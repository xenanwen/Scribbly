import {
  MIN_PASSWORD,
  passwordStrength,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
} from '../src/lib/validate'

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, e = '') => {
  if (c) pass++
  else {
    fail++
    console.log('  FAIL:', n, e)
  }
}

/* ===== email ============================================================= */
{
  const good = [
    'a@b.co',
    'someone@example.com',
    'first.last@sub.domain.org',
    'user+tag@example.co.uk',
    "o'brien@example.com",
    'UPPER@EXAMPLE.COM',
    '  padded@example.com  ', // trimmed before checking
  ]
  for (const e of good) ok(`accepts ${JSON.stringify(e)}`, validateEmail(e) === null, String(validateEmail(e)))

  const bad: [string, string][] = [
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['no-at-sign.com', 'missing @'],
    ['@example.com', 'nothing before @'],
    ['user@', 'nothing after @'],
    ['user@localhost', 'no dot in domain'],
    ['a@b@c.com', 'two @'],
    ['user@.com', 'domain starts with dot'],
    ['user@example.', 'domain ends with dot'],
    ['user@exa..mple.com', 'double dot'],
    ['has space@example.com', 'internal space'],
    [`${'x'.repeat(250)}@example.com`, 'too long'],
  ]
  for (const [e, why] of bad) ok(`rejects ${why}`, validateEmail(e) !== null, JSON.stringify(e))

  // Messages should be actionable, not just "invalid".
  ok('missing-@ message mentions @', (validateEmail('nope.com') ?? '').includes('@'))
  ok('no-dot message mentions dot', (validateEmail('a@b') ?? '').toLowerCase().includes('dot'))
  ok('empty message asks for it', (validateEmail('') ?? '').toLowerCase().includes('enter'))
}

/* ===== password ========================================================== */
{
  ok('MIN_PASSWORD is 8', MIN_PASSWORD === 8)
  ok('rejects empty', validatePassword('') !== null)
  ok(`rejects ${MIN_PASSWORD - 1} chars`, validatePassword('a'.repeat(MIN_PASSWORD - 1)) !== null)
  ok(`accepts exactly ${MIN_PASSWORD}`, validatePassword('a'.repeat(MIN_PASSWORD)) === null)
  ok('accepts long', validatePassword('a'.repeat(72)) === null)
  ok('rejects over 72 (bcrypt truncates)', validatePassword('a'.repeat(73)) !== null)
  ok('rejects all spaces', validatePassword('        ') !== null)
  ok('accepts spaces inside', validatePassword('two words here') === null)
  ok('accepts unicode', validatePassword('pässwörd✓') === null)

  // The short-password message should say how many more are needed.
  const msg = validatePassword('abc') ?? ''
  ok('short message counts remaining', msg.includes('5'), msg)
}

/* ===== confirmation ====================================================== */
{
  ok('empty confirmation rejected', validatePasswordConfirmation('abcdefgh', '') !== null)
  ok('mismatch rejected', validatePasswordConfirmation('abcdefgh', 'abcdefgi') !== null)
  ok('match accepted', validatePasswordConfirmation('abcdefgh', 'abcdefgh') === null)
  ok('case-sensitive', validatePasswordConfirmation('Abcdefgh', 'abcdefgh') !== null)
  ok('whitespace is significant', validatePasswordConfirmation('abcdefgh ', 'abcdefgh') !== null)
}

/* ===== strength meter ==================================================== */
{
  ok('too short is weak', passwordStrength('abc') === 'weak')
  ok('8 lowercase is weak', passwordStrength('abcdefgh') === 'weak')
  ok('10 lowercase reaches fair', passwordStrength('abcdefghij') === 'fair')
  ok('8 chars 3 classes is fair', passwordStrength('Abcdef1!'.slice(0, 8)) === 'fair')
  ok('12 mixed is good', passwordStrength('Abcdefghij12') === 'good')
  ok('16 mixed is strong', passwordStrength('Abcdefghijklmn12') === 'strong')
  ok('long passphrase is strong', passwordStrength('correct horse battery staple') === 'strong')

  // Monotonic-ish: appending characters must never lower the rating.
  const rank = { weak: 0, fair: 1, good: 2, strong: 3 }
  let worst = ''
  let regressions = 0
  const base = 'Aa1!'
  for (let i = 1; i <= 24; i++) {
    const s = base + 'x'.repeat(i)
    if (worst && rank[passwordStrength(s)] < rank[passwordStrength(worst)]) regressions++
    worst = s
  }
  ok('strength never decreases as length grows', regressions === 0, `${regressions} regressions`)

  // Every result is one of the four labels the CSS styles.
  const labels = new Set(['weak', 'fair', 'good', 'strong'])
  const samples = ['', 'a', 'abcdefgh', 'Abcdefgh1', 'Abcdefghijklmnop1!', '  ', '🔒🔒🔒🔒🔒🔒🔒🔒']
  ok('always returns a known label', samples.every((s) => labels.has(passwordStrength(s))))
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exitCode = 1
