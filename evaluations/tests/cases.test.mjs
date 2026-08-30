import assert from 'node:assert/strict'
import test from 'node:test'
import { renderVariables, validateSuite } from '../src/cases.mjs'

function validCase(id = 'one') {
  return {
    id,
    prompt: 'Visit {{fixtureBaseUrl}}/orders',
    reset: { method: 'POST', url: '{{fixtureBaseUrl}}/api/reset' },
    expected: {
      requiredTools: ['browser_use_task'],
      forbiddenTools: ['bash'],
      taskCompleted: true,
      stepScreenshots: 'present',
      maxDurationMs: 1000,
      oracle: { type: 'http-json', url: '{{fixtureBaseUrl}}/api/state', path: ['ok'], equals: true },
    },
  }
}

test('validates and renders a prompt suite without changing the prompt contract', () => {
  const suite = validateSuite({ formatVersion: 1, name: 'suite', cases: [validCase()] })
  const rendered = renderVariables(suite, { fixtureBaseUrl: 'http://127.0.0.1:4000' })
  assert.equal(rendered.cases[0].prompt, 'Visit http://127.0.0.1:4000/orders')
  assert.equal(rendered.cases[0].expected.oracle.url, 'http://127.0.0.1:4000/api/state')
})

test('rejects duplicate case ids', () => {
  assert.throws(
    () => validateSuite({ formatVersion: 1, name: 'suite', cases: [validCase(), validCase()] }),
    /duplicate case id/,
  )
})

test('rejects unknown template variables', () => {
  assert.throws(() => renderVariables('{{unknown}}', {}), /unknown evaluation variable/)
})
