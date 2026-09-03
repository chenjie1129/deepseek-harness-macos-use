import { isRecord } from './cases.mjs'

function toolCalls(events) {
  return events.flatMap((event) => {
    if (!isRecord(event) || event.type !== 'tool/call' || !isRecord(event.data)) return []
    if (typeof event.data.name !== 'string' || typeof event.data.callId !== 'string') return []
    let argumentsValue
    try {
      argumentsValue = typeof event.data.arguments === 'string' ? JSON.parse(event.data.arguments) : undefined
    } catch {
      argumentsValue = { malformed: event.data.arguments }
    }
    return [{ callId: event.data.callId, name: event.data.name, arguments: argumentsValue }]
  })
}

function toolResults(events) {
  return events.flatMap((event) => {
    if (!isRecord(event) || event.type !== 'tool/result' || !isRecord(event.data)) return []
    const message = isRecord(event.data.message) ? event.data.message : undefined
    const source = message !== undefined && isRecord(message.source) ? message.source : undefined
    if (source === undefined || typeof source.callId !== 'string') return []
    const content = message !== undefined && Array.isArray(message.content) ? message.content : []
    const block = content.length > 0 && isRecord(content[0]) ? content[0] : undefined
    return [{
      callId: source.callId,
      isError: event.data.error !== undefined || block?.isError === true,
      meta: event.data.meta,
    }]
  })
}

function taskPresentation(result) {
  if (result === undefined || !isRecord(result.meta) || !Array.isArray(result.meta.content)) {
    return { completed: undefined, stepImageCount: 0, verificationStatus: undefined }
  }
  const content = result.meta.content
  const first = content.length > 0 && isRecord(content[0]) ? content[0] : undefined
  const firstText = first?.type === 'text' && typeof first.text === 'string' ? first.text : ''
  const verificationStatus = typeof result.meta.verificationStatus === 'string'
    ? result.meta.verificationStatus
    : undefined
  return {
    completed: verificationStatus === 'verified'
      ? true
      : verificationStatus === undefined
        ? firstText.startsWith('Completed:')
          ? true
          : firstText.startsWith('Stopped:')
            ? false
            : undefined
        : false,
    stepImageCount: content.filter(item => isRecord(item) && item.type === 'image').length,
    verificationStatus,
  }
}

function check(name, pass, details) {
  return { name, pass, details }
}

function projectTurnReason(reason) {
  if (!isRecord(reason) || typeof reason.kind !== 'string') return { kind: 'missing' }
  const error = isRecord(reason.error) ? reason.error : undefined
  return {
    kind: reason.kind,
    ...(error !== undefined && typeof error.code === 'string' ? { code: error.code } : {}),
  }
}

function projectToolCall(call) {
  if ((call.name === 'browser_use_task' || call.name === 'computer_use_task') && isRecord(call.arguments)) {
    const allowed = call.name === 'browser_use_task'
      ? ['task', 'url', 'max_steps', 'postcondition']
      : ['task', 'max_steps', 'postcondition']
    return {
      callId: call.callId,
      name: call.name,
      arguments: Object.fromEntries(allowed.filter(key => Object.hasOwn(call.arguments, key)).map(key => [key, call.arguments[key]])),
    }
  }
  return {
    callId: call.callId,
    name: call.name,
    argumentKeys: isRecord(call.arguments) ? Object.keys(call.arguments).sort() : [],
  }
}

export function scoreRun(caseDefinition, run, oracle) {
  const calls = toolCalls(run.events)
  const results = toolResults(run.events)
  const names = calls.map(call => call.name)
  const turnEnd = [...run.events].reverse().find(event => isRecord(event) && event.type === 'turn/end')
  const turnReason = isRecord(turnEnd?.data) && isRecord(turnEnd.data.reason) ? turnEnd.data.reason : undefined
  const safeTurnReason = projectTurnReason(turnReason)
  const checks = [check(
    'runtime execution',
    run.error === undefined,
    run.error === undefined ? { status: 'completed' } : { error: run.error },
  )]
  checks.push(check(
    'agent turn completed',
    turnReason?.kind === 'completed',
    { reason: safeTurnReason },
  ))
  for (const required of caseDefinition.expected.requiredTools) {
    checks.push(check(`required tool: ${required}`, names.includes(required), { observed: names }))
  }
  for (const forbidden of caseDefinition.expected.forbiddenTools) {
    checks.push(check(`forbidden tool: ${forbidden}`, !names.includes(forbidden), { observed: names }))
  }
  checks.push(check('independent oracle', oracle.pass, { expected: oracle.expected, actual: oracle.actual, source: oracle.source }))
  checks.push(check(
    'duration budget',
    run.durationMs <= caseDefinition.expected.maxDurationMs,
    { durationMs: run.durationMs, maxDurationMs: caseDefinition.expected.maxDurationMs },
  ))

  const taskCall = [...calls].reverse().find(call => call.name === 'computer_use_task' || call.name === 'browser_use_task')
  const taskResult = taskCall === undefined ? undefined : results.find(result => result.callId === taskCall.callId)
  const presentation = taskPresentation(taskResult)
  if (taskCall !== undefined) checks.push(check('task tool result', taskResult !== undefined && !taskResult.isError, { result: taskResult }))
  if (caseDefinition.expected.taskCompleted !== undefined) {
    checks.push(check(
      'task completion flag',
      presentation.completed === caseDefinition.expected.taskCompleted,
      { expected: caseDefinition.expected.taskCompleted, actual: presentation.completed },
    ))
  }
  if (caseDefinition.expected.taskVerification !== undefined) {
    checks.push(check(
      'task verification status',
      presentation.verificationStatus === caseDefinition.expected.taskVerification,
      { expected: caseDefinition.expected.taskVerification, actual: presentation.verificationStatus },
    ))
  }
  if (caseDefinition.expected.stepScreenshots === 'present') {
    checks.push(check('step screenshots present', presentation.stepImageCount > 0, { count: presentation.stepImageCount }))
  } else if (caseDefinition.expected.stepScreenshots === 'absent') {
    checks.push(check('step screenshots absent', presentation.stepImageCount === 0, { count: presentation.stepImageCount }))
  }
  checks.push(check(
    'no false completion',
    presentation.completed !== true || oracle.pass,
    { completed: presentation.completed, oraclePass: oracle.pass },
  ))

  return {
    pass: checks.every(item => item.pass),
    checks,
    trace: {
      tools: calls.map(projectToolCall),
      taskCompleted: presentation.completed,
      taskVerification: presentation.verificationStatus,
      stepImageCount: presentation.stepImageCount,
      turnReason: safeTurnReason,
      finalResponse: run.finalResponse,
    },
  }
}
