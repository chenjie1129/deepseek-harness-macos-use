import { readFile } from 'node:fs/promises'

export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string' && item.length > 0)) {
    throw new Error(`${label} must be an array of non-empty strings`)
  }
  return value
}

function validateOracle(value, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  if (value.type === 'http-json') {
    requireString(value.url, `${label}.url`)
    if (!Array.isArray(value.path) || !value.path.every(part => typeof part === 'string' && part.length > 0)) {
      throw new Error(`${label}.path must be an array of non-empty strings`)
    }
    if (!Object.hasOwn(value, 'equals')) throw new Error(`${label}.equals is required`)
    return
  }
  if (value.type === 'file') {
    requireString(value.path, `${label}.path`)
    if (typeof value.exists !== 'boolean') throw new Error(`${label}.exists must be boolean`)
    if (value.textEquals !== undefined && typeof value.textEquals !== 'string') {
      throw new Error(`${label}.textEquals must be a string when present`)
    }
    return
  }
  throw new Error(`${label}.type must be "http-json" or "file"`)
}

function validateCase(value, index) {
  const label = `cases[${String(index)}]`
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  const id = requireString(value.id, `${label}.id`)
  const prompt = requireString(value.prompt, `${label}.prompt`)
  if (!isRecord(value.expected)) throw new Error(`${label}.expected must be an object`)
  const expected = value.expected
  const requiredTools = requireStringArray(expected.requiredTools ?? [], `${label}.expected.requiredTools`)
  const forbiddenTools = requireStringArray(expected.forbiddenTools ?? [], `${label}.expected.forbiddenTools`)
  if (expected.taskCompleted !== undefined && typeof expected.taskCompleted !== 'boolean') {
    throw new Error(`${label}.expected.taskCompleted must be boolean when present`)
  }
  if (expected.stepScreenshots !== undefined
    && expected.stepScreenshots !== 'present'
    && expected.stepScreenshots !== 'absent'
    && expected.stepScreenshots !== 'ignore') {
    throw new Error(`${label}.expected.stepScreenshots must be present, absent, or ignore`)
  }
  if (!Number.isSafeInteger(expected.maxDurationMs) || expected.maxDurationMs <= 0) {
    throw new Error(`${label}.expected.maxDurationMs must be a positive safe integer`)
  }
  validateOracle(expected.oracle, `${label}.expected.oracle`)

  let reset
  if (value.reset !== undefined) {
    if (!isRecord(value.reset)) throw new Error(`${label}.reset must be an object`)
    if (value.reset.method !== 'POST') throw new Error(`${label}.reset.method must be POST`)
    reset = { method: 'POST', url: requireString(value.reset.url, `${label}.reset.url`) }
  }
  return {
    id,
    prompt,
    ...(reset === undefined ? {} : { reset }),
    expected: {
      requiredTools,
      forbiddenTools,
      ...(expected.taskCompleted === undefined ? {} : { taskCompleted: expected.taskCompleted }),
      stepScreenshots: expected.stepScreenshots ?? 'ignore',
      maxDurationMs: expected.maxDurationMs,
      oracle: expected.oracle,
    },
  }
}

export function validateSuite(value) {
  if (!isRecord(value)) throw new Error('evaluation suite must be an object')
  if (value.formatVersion !== 1) throw new Error(`formatVersion must be 1, got ${String(value.formatVersion)}`)
  const name = requireString(value.name, 'name')
  if (!Array.isArray(value.cases) || value.cases.length === 0) throw new Error('cases must be a non-empty array')
  const cases = value.cases.map(validateCase)
  const ids = new Set()
  for (const item of cases) {
    if (ids.has(item.id)) throw new Error(`duplicate case id: ${item.id}`)
    ids.add(item.id)
  }
  return { formatVersion: 1, name, cases }
}

export async function loadSuite(path) {
  const text = await readFile(path, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`cannot parse evaluation suite ${path}: ${String(error)}`)
  }
  return validateSuite(parsed)
}

export function renderVariables(value, variables) {
  if (typeof value === 'string') {
    return value.replaceAll(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_match, name) => {
      if (!Object.hasOwn(variables, name)) throw new Error(`unknown evaluation variable: ${name}`)
      return variables[name]
    })
  }
  if (Array.isArray(value)) return value.map(item => renderVariables(item, variables))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderVariables(item, variables)]))
  }
  return value
}
