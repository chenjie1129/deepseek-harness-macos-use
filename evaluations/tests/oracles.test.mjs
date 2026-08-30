import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { evaluateOracle } from '../src/oracles.mjs'
import { startFixtureServer } from '../src/fixture-server.mjs'

test('HTTP JSON oracle reads state outside the agent transcript', async (context) => {
  const fixture = await startFixtureServer()
  context.after(() => fixture.close())
  const result = await evaluateOracle({
    type: 'http-json',
    url: `${fixture.baseUrl}/api/state`,
    path: ['orders', 'A-1042', 'status'],
    equals: 'Pending',
  }, { workspace: process.cwd() })
  assert.equal(result.pass, true)
  const objectResult = await evaluateOracle({
    type: 'http-json',
    url: `${fixture.baseUrl}/api/state`,
    path: ['orders'],
    equals: { 'A-1042': { status: 'Pending' } },
  }, { workspace: process.cwd() })
  assert.equal(objectResult.pass, true)
})

test('file oracle is confined to its evaluation workspace', async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-oracle-test-'))
  context.after(() => rm(workspace, { recursive: true, force: true }))
  await writeFile(join(workspace, 'result.txt'), 'ok', 'utf8')
  const result = await evaluateOracle({ type: 'file', path: 'result.txt', exists: true, textEquals: 'ok' }, { workspace })
  assert.equal(result.pass, true)
  assert.match(result.actual.textSha256, /^[a-f0-9]{64}$/)
  assert.equal(Object.hasOwn(result.actual, 'text'), false)
  await assert.rejects(
    evaluateOracle({ type: 'file', path: '../outside.txt', exists: false }, { workspace }),
    /leaves the evaluation workspace/,
  )
  const external = join(tmpdir(), `dsh-oracle-external-${process.pid}.txt`)
  await writeFile(external, 'outside', 'utf8')
  context.after(() => rm(external, { force: true }))
  await symlink(external, join(workspace, 'linked.txt'))
  await assert.rejects(
    evaluateOracle({ type: 'file', path: 'linked.txt', exists: true, textEquals: 'outside' }, { workspace }),
    /resolves outside the evaluation workspace/,
  )
})
