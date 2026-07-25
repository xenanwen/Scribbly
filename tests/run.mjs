/* Minimal test runner.
 *
 * The suites here only exercise pure functions (ordering maths, filtering, date
 * urgency) so they don't need jsdom or a component testing library. esbuild
 * strips the types, node runs the result. Keeps `npm test` to two dependencies
 * we already have.
 */
import { build } from 'esbuild'
import { readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '.build')

const suites = (await readdir(here)).filter((f) => f.endsWith('.test.ts')).sort()

await build({
  entryPoints: suites.map((f) => join(here, f)),
  outdir: outDir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  define: { 'import.meta.env': '{"DEV":false}' },
  logLevel: 'error',
})

let failed = 0
for (const suite of suites) {
  console.log(`\n▸ ${suite}`)
  const mod = join(outDir, suite.replace(/\.ts$/, '.js'))
  try {
    await import(`file://${mod}`)
    // Suites set process.exitCode rather than calling process.exit, so that one
    // failing suite doesn't stop the rest from running.
    if (process.exitCode) {
      failed += 1
      process.exitCode = 0
    }
  } catch (err) {
    failed += 1
    console.error(err)
  }
}

await rm(outDir, { recursive: true, force: true })

if (failed > 0) {
  console.error(`\n${failed} suite(s) failed`)
  process.exit(1)
}
console.log('\nAll suites passed.')
