import { createServer } from 'node:http'

function sendJson(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  })
  response.end(text)
}

function completion(model, delta, finishReason = null, usage) {
  return {
    id: 'dsh-eval-deterministic',
    object: 'chat.completion.chunk',
    created: 1,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage === undefined ? {} : { usage }),
  }
}

function sendSse(response, chunks) {
  response.writeHead(200, {
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'content-type': 'text/event-stream; charset=utf-8',
  })
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  response.end('data: [DONE]\n\n')
}

function messageText(message) {
  if (typeof message?.content === 'string') return message.content
  if (!Array.isArray(message?.content)) return ''
  return message.content
    .filter(part => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
}

function lastUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === 'user') return messageText(messages[index])
  }
  return ''
}

function browserUrl(text) {
  const match = text.match(/https?:\/\/[^\s,]+\/(?:orders|tickets|invoices)/)
  if (match === null) throw new Error('deterministic driver could not find a fixture URL in the user prompt')
  return match[0]
}

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export async function startDeterministicProvider({ host = '127.0.0.1', port = 0 } = {}) {
  const metrics = {
    driverRequests: 0,
    guiRequests: 0,
    toolCallsIssued: 0,
    lastDriverToolCount: 0,
    browserUseTaskAvailable: false,
    lastDriverStream: null,
    lastDriverMessageRoles: [],
  }
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
      return sendJson(response, 404, { error: { message: 'not found' } })
    }
    let body
    try {
      body = await readJson(request)
    } catch (error) {
      return sendJson(response, 400, { error: { message: `invalid JSON: ${String(error)}` } })
    }
    const model = typeof body.model === 'string' ? body.model : 'unknown'
    const messages = Array.isArray(body.messages) ? body.messages : []
    if (model === 'deterministic-gui-fixture') {
      metrics.guiRequests += 1
      const prompt = lastUserText(messages)
      const action = prompt.includes('Prior steps:')
        ? { kind: 'done', summary: 'Order A-1042 is visibly marked Reviewed.' }
        : { kind: 'click', x: 640, y: 320, reason: 'Activate the large review-and-save button.' }
      return sendJson(response, 200, {
        id: 'dsh-eval-gui',
        object: 'chat.completion',
        created: 1,
        model,
        choices: [{
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: JSON.stringify(action) },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    }

    metrics.driverRequests += 1
    const tools = Array.isArray(body.tools) ? body.tools : []
    const toolNames = tools.map(tool => tool?.function?.name).filter(name => typeof name === 'string')
    metrics.lastDriverToolCount = toolNames.length
    metrics.browserUseTaskAvailable = toolNames.includes('browser_use_task')
    metrics.lastDriverStream = body.stream
    metrics.lastDriverMessageRoles = messages.map(message => message?.role)
    const hasToolResult = messages.some(message => message?.role === 'tool')
    if (body.stream === true && toolNames.includes('browser_use_task') && !hasToolResult) {
      let url
      try {
        url = browserUrl(messages.map(messageText).join('\n'))
      } catch (error) {
        return sendJson(response, 400, { error: { message: error instanceof Error ? error.message : String(error) } })
      }
      metrics.toolCallsIssued += 1
      const callId = 'dsh-eval-browser-call'
      return sendSse(response, [
        completion(model, { role: 'assistant' }),
        completion(model, {
          tool_calls: [{
            index: 0,
            id: callId,
            type: 'function',
            function: {
              name: 'browser_use_task',
              arguments: JSON.stringify({
                task: 'Find order A-1042 and use the visible control to mark it Reviewed and save the change.',
                url,
                max_steps: 3,
                postcondition: {
                  url_contains: '/orders',
                  text_contains: 'Reviewed',
                },
              }),
            },
          }],
        }),
        completion(model, {}, 'tool_calls', { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
      ])
    }

    const text = hasToolResult
      ? 'The browser task finished. The external evaluator will independently verify the saved state.'
      : 'No deterministic browser action was selected.'
    if (body.stream === true) {
      return sendSse(response, [
        completion(model, { role: 'assistant' }),
        completion(model, { content: text }),
        completion(model, {}, 'stop', { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
      ])
    }
    return sendJson(response, 200, {
      id: 'dsh-eval-nonstream',
      object: 'chat.completion',
      created: 1,
      model,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
  })
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(port, host, () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('deterministic provider did not bind a TCP port')
  return {
    baseUrl: `http://${host}:${String(address.port)}/v1`,
    metrics,
    close: () => new Promise((resolveClose, rejectClose) => server.close(error => error === undefined ? resolveClose() : rejectClose(error))),
  }
}
