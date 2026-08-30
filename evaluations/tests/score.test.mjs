import assert from 'node:assert/strict'
import test from 'node:test'
import { scoreRun } from '../src/score.mjs'

function caseDefinition() {
  return {
    expected: {
      requiredTools: ['browser_use_task'],
      forbiddenTools: ['bash'],
      taskCompleted: true,
      stepScreenshots: 'present',
      maxDurationMs: 1_000,
    },
  }
}

function events() {
  return [
    { type: 'tool/call', data: { callId: 'call-1', name: 'browser_use_task', arguments: '{"url":"http://fixture/orders"}' } },
    {
      type: 'tool/result',
      data: {
        message: { source: { callId: 'call-1' }, content: [{ type: 'text', text: 'tool result' }] },
        meta: { content: [{ type: 'text', text: 'Completed: reviewed' }, { type: 'image', image: { id: 'step-1' } }] },
      },
    },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

test('passes only when tool behavior, presentation, duration, and oracle all pass', () => {
  const score = scoreRun(caseDefinition(), { events: events(), finalResponse: 'done', durationMs: 50 }, {
    pass: true,
    expected: 'Reviewed',
    actual: 'Reviewed',
    source: 'fixture state',
  })
  assert.equal(score.pass, true)
  assert.equal(score.trace.stepImageCount, 1)
})

test('fails false completion even when the tool says completed and emits a screenshot', () => {
  const score = scoreRun(caseDefinition(), { events: events(), finalResponse: 'done', durationMs: 50 }, {
    pass: false,
    expected: 'Reviewed',
    actual: 'Pending',
    source: 'fixture state',
  })
  assert.equal(score.pass, false)
  assert.equal(score.checks.find(check => check.name === 'no false completion').pass, false)
})

test('fails a runtime error even if fixture state happens to satisfy the oracle', () => {
  const score = scoreRun(caseDefinition(), { events: [], finalResponse: '', durationMs: 50, error: 'runtime crashed' }, {
    pass: true,
    expected: 'Reviewed',
    actual: 'Reviewed',
    source: 'fixture state',
  })
  assert.equal(score.pass, false)
  assert.equal(score.checks[0].name, 'runtime execution')
})

test('fails a provider-error turn even when the SDK transport reaches idle', () => {
  const failedEvents = [{ type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { code: 'HTTP_400', message: 'bad request' } } } }]
  const score = scoreRun(caseDefinition(), { events: failedEvents, finalResponse: '', durationMs: 50 }, {
    pass: false,
    expected: 'Reviewed',
    actual: 'Pending',
    source: 'fixture state',
  })
  assert.equal(score.checks.find(check => check.name === 'agent turn completed').pass, false)
  assert.equal(score.trace.turnReason.kind, 'error')
})
