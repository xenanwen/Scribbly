/* Sharing helpers. The invite-URL functions touch window.location, so this
   suite installs a tiny stub rather than pulling in jsdom for four functions. */

interface StubWindow {
  location: { href: string; pathname: string; search: string; hash: string }
  history: { replaceState: (a: unknown, b: string, url: string) => void }
}

const stub: StubWindow = {
  location: { href: '', pathname: '/', search: '', hash: '' },
  history: {
    replaceState: (_a, _b, url) => {
      const parsed = new URL(url, 'https://scribbly.app')
      stub.location.pathname = parsed.pathname
      stub.location.search = parsed.search
      stub.location.hash = parsed.hash
      stub.location.href = parsed.toString()
    },
  },
}

function setUrl(href: string) {
  const parsed = new URL(href)
  stub.location.href = parsed.toString()
  stub.location.pathname = parsed.pathname
  stub.location.search = parsed.search
  stub.location.hash = parsed.hash
}

;(globalThis as unknown as { window: StubWindow }).window = stub
;(globalThis as unknown as { localStorage: unknown }).localStorage = undefined

const { canEdit, ROLES } = await import('../src/lib/types')
const { inviteUrl, readInviteToken, clearInviteToken, rememberBoard, recallBoard } = await import(
  '../src/lib/boards'
)

let pass = 0,
  fail = 0
const ok = (n: string, c: boolean, e = '') => {
  if (c) pass++
  else {
    fail++
    console.log('  FAIL:', n, e)
  }
}

/* ===== roles ============================================================== */
{
  ok('three roles defined', ROLES.length === 3)
  ok('owner can edit', canEdit('owner'))
  ok('editor can edit', canEdit('editor'))
  ok('viewer cannot edit', !canEdit('viewer'))
}

/* ===== building an invite URL ============================================= */
{
  setUrl('https://scribbly.app/')
  const url = inviteUrl('abc-123_XYZ')
  ok('invite url carries the token', url.includes('invite=abc-123_XYZ'), url)
  ok('invite url keeps the origin', url.startsWith('https://scribbly.app/'), url)

  // A token already sitting in the URL must not be duplicated or appended to.
  setUrl('https://scribbly.app/?invite=OLD')
  const replaced = inviteUrl('NEW')
  ok('replaces an existing token', replaced.includes('invite=NEW') && !replaced.includes('OLD'), replaced)
  ok('only one invite param', (replaced.match(/invite=/g) ?? []).length === 1, replaced)

  // Any stale hash should be dropped, not carried into the shared link.
  setUrl('https://scribbly.app/?x=1#somewhere')
  const clean = inviteUrl('T')
  ok('drops the hash', !clean.includes('#'), clean)

  // Tokens are base64url; '-' and '_' must survive, and nothing needs escaping.
  setUrl('https://scribbly.app/')
  const tricky = inviteUrl('aB-_9xYz-_')
  ok('base64url chars survive unescaped', tricky.includes('invite=aB-_9xYz-_'), tricky)
}

/* ===== reading a token back ============================================== */
{
  setUrl('https://scribbly.app/?invite=tok123')
  ok('reads the token', readInviteToken() === 'tok123')

  setUrl('https://scribbly.app/')
  ok('no token when absent', readInviteToken() === null)

  setUrl('https://scribbly.app/?invite=')
  ok('empty token treated as absent', readInviteToken() === null)

  setUrl('https://scribbly.app/?invite=%20%20')
  ok('whitespace token treated as absent', readInviteToken() === null)

  setUrl('https://scribbly.app/?other=1&invite=tok&more=2')
  ok('finds token among other params', readInviteToken() === 'tok')

  setUrl('https://scribbly.app/?invite=a%2Bb%3D')
  ok('url-decodes the token', readInviteToken() === 'a+b=')
}

/* ===== clearing the token ================================================= */
{
  setUrl('https://scribbly.app/?invite=tok&keep=yes')
  clearInviteToken()
  ok('token removed', readInviteToken() === null, stub.location.search)
  ok('other params preserved', stub.location.search.includes('keep=yes'), stub.location.search)

  setUrl('https://scribbly.app/?invite=tok')
  clearInviteToken()
  ok('search emptied when it was the only param', stub.location.search === '', stub.location.search)

  // Idempotent: clearing twice must not throw or mangle the URL.
  clearInviteToken()
  ok('clearing twice is safe', readInviteToken() === null)
}

/* ===== board memory degrades gracefully ================================== */
{
  // localStorage is undefined in this environment, which is exactly the private
  // browsing case — these must not throw.
  let threw = false
  try {
    rememberBoard('board-1')
    ok('recall returns null without storage', recallBoard() === null)
  } catch {
    threw = true
  }
  ok('storage failure does not throw', !threw)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exitCode = 1
