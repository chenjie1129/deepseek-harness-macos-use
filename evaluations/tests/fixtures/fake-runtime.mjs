#!/usr/bin/env node

import { createInterface } from 'node:readline'

let sequence = 0

function write(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`)
}

function notify(method, params) {
  write({ jsonrpc: '2.0', method, params })
}

function event(sessionId, type, data) {
  notify('session.event', { sessionId, event: { type, seq: sequence++, time: 1, data } })
}

const reader = createInterface({ input: process.stdin })
reader.on('line', (line) => {
  const frame = JSON.parse(line)
  if (frame.method === 'initialize') {
    write({ jsonrpc: '2.0', id: frame.id, result: { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: 'test' } } })
    return
  }
  if (frame.method === 'session/prompt') {
    const sessionId = frame.params.sessionId
    const messageId = 'test-user-message'
    event(sessionId, 'agent/inbox/spliced', {
      inserted: [{ id: messageId, role: 'user', content: frame.params.contentBlocks, source: { kind: 'user' } }],
    })
    notify('session.status', { sessionId, status: 'running' })
    event(sessionId, 'assistant/message', {
      message: {
        id: 'assistant-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'fake complete' }],
        source: { kind: 'model', provider: 'fake', model: 'fake' },
      },
    })
    notify('session.status', { sessionId, status: 'idle' })
    // Deliberately acknowledge after the terminal notification. The real SDK
    // contract permits this ordering and the evaluator must retain it.
    write({ jsonrpc: '2.0', id: frame.id, result: { messageId } })
    return
  }
  if (frame.method === 'shutdown') {
    write({ jsonrpc: '2.0', id: frame.id, result: {} })
    setImmediate(() => process.exit(0))
  }
})
