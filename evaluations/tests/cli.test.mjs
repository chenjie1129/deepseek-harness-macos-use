import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import { deterministicEnvironment, parseArguments } from '../src/cli.mjs'

const execFileAsync = promisify(execFile)

test('CLI defaults to deterministic mode and requires an explicit Harness checkout', () => {
  const options = parseArguments(['--harness-root', '/tmp/example-harness'])
  assert.equal(options.mode, 'deterministic')
  assert.equal(options.runs, 1)
  assert.match(options.suitePath, /evaluations\/cases\/smoke\.json$/)
  assert.throws(() => parseArguments([]), /--harness-root is required/)
})

test('live mode requires the shared visual-configuration home and main model route', () => {
  assert.throws(
    () => parseArguments(['--mode', 'live', '--harness-root', '/tmp/harness']),
    /--dsh-home is required/,
  )
  assert.throws(
    () => parseArguments(['--mode', 'live', '--harness-root', '/tmp/harness', '--dsh-home', '/tmp/home']),
    /--provider and --model are required/,
  )
})

test('deterministic mode strips inherited credential and proxy variables', () => {
  assert.deepEqual(deterministicEnvironment({
    PATH: '/bin',
    OPENAI_API_KEY: 'secret',
    GITHUB_TOKEN: 'secret',
    HTTP_PROXY: 'http://name:password@example.test',
    PLAYWRIGHT_BROWSERS_PATH: '/browser-cache',
  }), {
    PATH: '/bin',
    PLAYWRIGHT_BROWSERS_PATH: '/browser-cache',
  })
})

test('CLI executes when its entry path contains a symlink such as macOS /tmp', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-eval-cli-link-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli.mjs')
  const linkedCli = join(directory, 'cli.mjs')
  await symlink(cli, linkedCli)
  const result = await execFileAsync(process.execPath, [linkedCli, '--help'])
  assert.match(result.stdout, /Prompt-level evaluation/)
})
