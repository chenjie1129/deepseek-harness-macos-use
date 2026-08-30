import assert from 'node:assert/strict'
import test from 'node:test'
import { deterministicEnvironment, parseArguments } from '../src/cli.mjs'

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
