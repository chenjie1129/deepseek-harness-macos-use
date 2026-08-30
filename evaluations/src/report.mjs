import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SENSITIVE_KEY = /(?:api.?key|authorization|password|secret|token)/i

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sanitize(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]'
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) return '[IMAGE DATA OMITTED]'
    return value.length <= 4_000 ? value : `${value.slice(0, 4_000)}…[TRUNCATED]`
  }
  if (Array.isArray(value)) return value.map(item => sanitize(item))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey)]))
  }
  return value
}

async function optionalFileHash(path) {
  try {
    await access(path)
    return sha256(await readFile(path))
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return null
    throw error
  }
}

async function gitState(root) {
  try {
    const [head, status] = await Promise.all([
      execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root }),
      execFileAsync('git', ['status', '--porcelain'], { cwd: root }),
    ])
    return { gitHead: head.stdout.trim(), gitDirty: status.stdout.trim().length > 0 }
  } catch {
    return { gitHead: null, gitDirty: null }
  }
}

function markdown(report, jsonName) {
  const passed = report.results.filter(result => result.pass).length
  const harnessState = report.harness.gitDirty === true ? 'dirty integration tree' : report.harness.gitDirty === false ? 'clean tree' : 'unknown tree state'
  const pluginState = report.plugin.gitDirty === true ? 'dirty tree' : report.plugin.gitDirty === false ? 'clean tree' : 'unknown tree state'
  const lines = [
    `# ${report.suite.name}`,
    '',
    `Outcome: **${report.pass ? 'PASS' : 'FAIL'}** (${String(passed)}/${String(report.results.length)} trials passed).`,
    '',
    `Mode: \`${report.run.mode}\`  `,
    `Provider/model: \`${report.run.provider}\` / \`${report.run.model}\`  `,
    `Harness commit: \`${report.harness.gitHead ?? 'unknown'}\` (${harnessState})  `,
    `Plugin commit: \`${report.plugin.gitHead ?? 'unknown'}\` (${pluginState})  `,
    `Settings SHA-256: \`${report.run.settingsSha256 ?? 'no settings file'}\`  `,
    `Machine-readable report: [${jsonName}](./${jsonName})`,
    '',
    '| Case | Trial | Result | Duration | Failed checks |',
    '| --- | ---: | --- | ---: | --- |',
  ]
  for (const result of report.results) {
    const failed = result.checks.filter(check => !check.pass).map(check => check.name).join(', ')
    lines.push(`| ${result.caseId} | ${String(result.trial)} | ${result.pass ? 'PASS' : 'FAIL'} | ${String(result.durationMs)} ms | ${failed || '—'} |`)
  }
  lines.push('', 'A GUI task completion flag and emitted screenshots are reported as checks, but only the independent oracle establishes task success.', '')
  return lines.join('\n')
}

export async function buildReport({
  suite,
  suitePath,
  mode,
  provider,
  model,
  harnessRoot,
  pluginRoot,
  dshHome,
  patches,
  startedAt,
  finishedAt,
  results,
  serverInfo,
  deterministicMetrics,
}) {
  const safeResults = sanitize(results)
  const [harness, plugin] = await Promise.all([gitState(harnessRoot), gitState(pluginRoot)])
  return {
    formatVersion: 1,
    generatedAt: finishedAt,
    pass: safeResults.every(result => result.pass),
    suite: {
      name: suite.name,
      path: basename(suitePath),
      sha256: sha256(await readFile(suitePath)),
    },
    run: {
      mode,
      provider,
      model,
      startedAt,
      finishedAt,
      settingsSha256: await optionalFileHash(resolve(dshHome, 'settings.yaml')),
      patches: await Promise.all(patches.map(async path => ({ name: basename(path), sha256: sha256(await readFile(path)) }))),
      ...(deterministicMetrics === undefined ? {} : { deterministicMetrics: sanitize(deterministicMetrics) }),
    },
    harness: { ...harness, serverInfo },
    plugin,
    host: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
    },
    results: safeResults,
  }
}

export async function writeReport(report, reportDirectory) {
  const output = resolve(reportDirectory)
  await mkdir(output, { recursive: true })
  const stamp = report.generatedAt.replaceAll(/[:.]/g, '-')
  const stem = `${stamp}-${report.suite.name.replaceAll(/[^A-Za-z0-9_-]+/g, '-')}`
  const jsonPath = join(output, `${stem}.json`)
  const markdownPath = join(output, `${stem}.md`)
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(markdownPath, markdown(report, basename(jsonPath)), 'utf8')
  return { jsonPath, markdownPath }
}
