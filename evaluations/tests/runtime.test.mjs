import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { JsonRpcRuntime } from '../src/runtime.mjs'

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/fake-runtime.mjs')

test('runtime retains a complete prompt interval when notifications precede acknowledgement', async () => {
  const runtime = new JsonRpcRuntime({
    command: process.execPath,
    args: [fixture],
    cwd: process.cwd(),
    env: process.env,
    description: 'fake runtime',
  })
  try {
    const info = await runtime.initialize({ cwd: process.cwd(), provider: 'fake', model: 'fake' })
    assert.deepEqual(info, { name: 'deepseek-harness-sdk-runtime', version: 'test' })
    const result = await runtime.runPrompt('exact user prompt', 2_000)
    assert.equal(result.finalResponse, 'fake complete')
    assert.equal(result.events[0].type, 'agent/inbox/spliced')
    assert.equal(result.notifications.at(-1).method, 'session.status')
  } finally {
    await runtime.close()
  }
})
