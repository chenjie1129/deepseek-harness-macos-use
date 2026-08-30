import assert from 'node:assert/strict'
import test from 'node:test'
import { startDeterministicProvider } from '../src/deterministic-provider.mjs'

test('deterministic provider drives the browser tool then declares GUI completion after one action', async (context) => {
  const provider = await startDeterministicProvider()
  context.after(() => provider.close())
  const driverResponse = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'deterministic-driver',
      stream: true,
      messages: [{ role: 'user', content: 'Use http://127.0.0.1:4000/orders' }],
      tools: [{ type: 'function', function: { name: 'browser_use_task', parameters: {} } }],
    }),
  })
  const stream = await driverResponse.text()
  assert.match(stream, /browser_use_task/)
  assert.match(stream, /127\.0\.0\.1:4000\\?\/orders/)

  const gui = async text => (await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'deterministic-gui-fixture',
      messages: [{ role: 'user', content: [{ type: 'text', text }] }],
    }),
  })).json()
  const first = JSON.parse((await gui('Task: review')).choices[0].message.content)
  const second = JSON.parse((await gui('Task: review\nPrior steps:')).choices[0].message.content)
  assert.deepEqual(first, { kind: 'click', x: 640, y: 320, reason: 'Activate the large review-and-save button.' })
  assert.equal(second.kind, 'done')
  assert.deepEqual(provider.metrics, {
    driverRequests: 1,
    guiRequests: 2,
    toolCallsIssued: 1,
    lastDriverToolCount: 1,
    browserUseTaskAvailable: true,
    lastDriverStream: true,
    lastDriverMessageRoles: ['user'],
  })
})
