import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

async function request(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url} returned ${String(response.status)}`)
  return response
}

export async function resetCase(reset) {
  if (reset === undefined) return
  await request(reset.url, { method: reset.method })
}

function readPath(value, path) {
  let current = value
  for (const part of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current) || !Object.hasOwn(current, part)) {
      return { found: false }
    }
    current = current[part]
  }
  return { found: true, value: current }
}

function textHash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function isInside(base, candidate) {
  const relation = relative(base, candidate)
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation))
}

function workspacePath(workspace, candidate) {
  const root = resolve(workspace)
  const absolute = resolve(root, candidate)
  if (!isInside(root, absolute)) {
    throw new Error(`file oracle path leaves the evaluation workspace: ${candidate}`)
  }
  return absolute
}

async function fileExists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return false
    throw error
  }
}

export async function evaluateOracle(oracle, options) {
  if (oracle.type === 'http-json') {
    const payload = await (await request(oracle.url)).json()
    const actual = readPath(payload, oracle.path)
    return {
      pass: actual.found && isDeepStrictEqual(actual.value, oracle.equals),
      expected: oracle.equals,
      actual: actual.found ? actual.value : { missingPath: oracle.path },
      source: oracle.url,
    }
  }
  if (oracle.type === 'file') {
    const path = workspacePath(options.workspace, oracle.path)
    const exists = await fileExists(path)
    if (exists) {
      const [realWorkspace, realCandidate] = await Promise.all([realpath(options.workspace), realpath(path)])
      if (!isInside(realWorkspace, realCandidate)) {
        throw new Error(`file oracle path resolves outside the evaluation workspace: ${oracle.path}`)
      }
    }
    let actualText
    if (exists && oracle.textEquals !== undefined) actualText = await readFile(path, 'utf8')
    const textPass = oracle.textEquals === undefined || actualText === oracle.textEquals
    return {
      pass: exists === oracle.exists && textPass,
      expected: { exists: oracle.exists, ...(oracle.textEquals === undefined ? {} : { textSha256: textHash(oracle.textEquals) }) },
      actual: { exists, ...(actualText === undefined ? {} : { textSha256: textHash(actualText) }) },
      source: path,
    }
  }
  throw new Error(`unsupported oracle type: ${String(oracle.type)}`)
}
