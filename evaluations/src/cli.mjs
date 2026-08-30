#!/usr/bin/env node

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { loadSuite, renderVariables, validateSuite } from './cases.mjs'
import { startDeterministicProvider } from './deterministic-provider.mjs'
import { startFixtureServer } from './fixture-server.mjs'
import { evaluateOracle, resetCase } from './oracles.mjs'
import { buildReport, writeReport } from './report.mjs'
import { harnessRuntimeOptions, JsonRpcRuntime } from './runtime.mjs'
import { scoreRun } from './score.mjs'

const evaluationRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginRoot = resolve(evaluationRoot, '..')
const SENSITIVE_ENV_NAME = /(?:api.?key|authorization|cookie|credential|password|secret|token|_proxy$)/i

export function deterministicEnvironment(source) {
  return Object.fromEntries(Object.entries(source).filter(([name]) => !SENSITIVE_ENV_NAME.test(name)))
}

function usage() {
  return `Prompt-level evaluation for DeepSeek Harness macOS Use

Usage:
  node src/cli.mjs --mode deterministic --harness-root /path/to/deepseek-harness
  node src/cli.mjs --mode live --harness-root /path/to/deepseek-harness \\
    --dsh-home /path/to/dsh-home --provider PROVIDER --model MODEL

Options:
  --mode deterministic|live  Evaluation mode (default: deterministic)
  --suite PATH               Case manifest (default: cases/smoke.json)
  --harness-root PATH        DeepSeek Harness source checkout (or DSH_HARNESS_ROOT)
  --dsh-home PATH            Harness home configured in the web Plugin Configuration page
  --provider ID              Main agent provider for live trials
  --model ID                 Main agent model for live trials
  --runs N                   Fresh trials per case (default: 1)
  --workspace PATH           Oracle-constrained workspace (default: isolated temporary directory)
  --patch PATH               Additional Harness patch; repeatable
  --report-dir PATH          Output directory (default: evaluations/reports)
  --help                     Show this help
`
}

function valueAfter(argv, index, option) {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`)
  return value
}

export function parseArguments(argv) {
  const values = { patches: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]
    if (option === '--help') return { help: true }
    if (option === '--patch') {
      values.patches.push(resolve(valueAfter(argv, index, option)))
      index += 1
      continue
    }
    if (!['--mode', '--suite', '--harness-root', '--dsh-home', '--provider', '--model', '--runs', '--workspace', '--report-dir'].includes(option)) {
      throw new Error(`unknown option: ${option}`)
    }
    const value = valueAfter(argv, index, option)
    values[option.slice(2).replaceAll(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] = value
    index += 1
  }
  const mode = values.mode ?? 'deterministic'
  if (mode !== 'deterministic' && mode !== 'live') throw new Error('--mode must be deterministic or live')
  const runs = Number(values.runs ?? 1)
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > 100) throw new Error('--runs must be an integer from 1 to 100')
  const harnessRoot = values.harnessRoot ?? process.env.DSH_HARNESS_ROOT
  if (harnessRoot === undefined) throw new Error('--harness-root is required (or set DSH_HARNESS_ROOT)')
  if (mode === 'live' && values.dshHome === undefined) throw new Error('--dsh-home is required in live mode')
  if (mode === 'live' && (values.provider === undefined || values.model === undefined)) {
    throw new Error('--provider and --model are required in live mode')
  }
  return {
    help: false,
    mode,
    runs,
    harnessRoot: resolve(harnessRoot),
    suitePath: resolve(values.suite ?? join(evaluationRoot, 'cases/smoke.json')),
    reportDirectory: resolve(values.reportDir ?? join(evaluationRoot, 'reports')),
    ...(values.dshHome === undefined ? {} : { dshHome: resolve(values.dshHome) }),
    ...(values.workspace === undefined ? {} : { workspace: resolve(values.workspace) }),
    provider: values.provider,
    model: values.model,
    patches: values.patches,
  }
}

async function requireVisualPluginSettings(dshHome) {
  let settings
  try {
    settings = await readFile(resolve(dshHome, 'settings.yaml'), 'utf8')
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
      throw new Error(`live mode found no ${resolve(dshHome, 'settings.yaml')}; configure GUI Model and GUI Agent in the Plugin Configuration page first`)
    }
    throw error
  }
  const missing = ['gui-model', 'tool-macos-use'].filter(section => !new RegExp(`^${section}:`, 'm').test(settings))
  if (missing.length > 0) {
    throw new Error(`live mode is missing Plugin Configuration sections: ${missing.join(', ')}`)
  }
}

function failedOracle(oracle, error) {
  return {
    pass: false,
    expected: oracle.type === 'file'
      ? { exists: oracle.exists, textEqualsConfigured: oracle.textEquals !== undefined }
      : oracle.equals,
    actual: { error: error instanceof Error ? error.message : String(error) },
    source: oracle.url ?? oracle.path,
  }
}

async function oneTrial({ caseDefinition, trial, runtimeOptions, initialize, workspace }) {
  const trialStarted = new Date().toISOString()
  let runtime
  let run = { events: [], finalResponse: '', durationMs: 0 }
  let serverInfo
  const wallStarted = Date.now()
  try {
    await resetCase(caseDefinition.reset)
    runtime = new JsonRpcRuntime(runtimeOptions)
    serverInfo = await runtime.initialize(initialize)
    run = await runtime.runPrompt(caseDefinition.prompt, caseDefinition.expected.maxDurationMs)
  } catch (error) {
    run = {
      ...run,
      durationMs: Math.max(run.durationMs, Date.now() - wallStarted),
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await runtime?.close().catch(() => {})
  }
  let oracle
  try {
    oracle = await evaluateOracle(caseDefinition.expected.oracle, { workspace })
  } catch (error) {
    oracle = failedOracle(caseDefinition.expected.oracle, error)
  }
  const score = scoreRun(caseDefinition, run, oracle)
  return {
    caseId: caseDefinition.id,
    trial,
    prompt: caseDefinition.prompt,
    startedAt: trialStarted,
    durationMs: run.durationMs,
    ...score,
    oracle,
    ...(run.error === undefined ? {} : { error: run.error }),
    serverInfo,
  }
}

export async function runEvaluation(options) {
  const startedAt = new Date().toISOString()
  const ownedTemporaryPaths = []
  let fixture
  let providerServer
  try {
    const rawSuite = await loadSuite(options.suitePath)
    fixture = await startFixtureServer()
    const suite = validateSuite(renderVariables(rawSuite, { fixtureBaseUrl: fixture.baseUrl }))
    const workspace = options.workspace ?? await mkdtemp(join(tmpdir(), 'dsh-macos-eval-workspace-'))
    if (options.workspace === undefined) ownedTemporaryPaths.push(workspace)

    let dshHome = options.dshHome
    let provider = options.provider
    let model = options.model
    let patches
    let environment = { ...process.env }
    if (options.mode === 'deterministic') {
      providerServer = await startDeterministicProvider()
      dshHome = await mkdtemp(join(tmpdir(), 'dsh-macos-eval-home-'))
      ownedTemporaryPaths.push(dshHome)
      provider = 'deepseek-official'
      model = 'deterministic-driver'
      patches = [join(evaluationRoot, 'profile/deterministic.cordis.patch.yml'), ...options.patches]
      environment = deterministicEnvironment(environment)
      environment.DEEPSEEK_API_KEY = 'deterministic-evaluation-key'
      environment.GUI_MODEL_API_KEY = 'deterministic-evaluation-key'
      environment.DSH_EVAL_PROVIDER_BASE_URL = providerServer.baseUrl
    } else {
      await requireVisualPluginSettings(dshHome)
      patches = [join(evaluationRoot, 'profile/plugin.cordis.patch.yml'), ...options.patches]
    }

    const runtimeOptions = harnessRuntimeOptions({
      harnessRoot: options.harnessRoot,
      patches,
      dshHome,
      environment,
    })
    const results = []
    let firstServerInfo
    for (const caseDefinition of suite.cases) {
      for (let trial = 1; trial <= options.runs; trial += 1) {
        const result = await oneTrial({
          caseDefinition,
          trial,
          runtimeOptions,
          initialize: { cwd: workspace, provider, model },
          workspace,
        })
        firstServerInfo ??= result.serverInfo
        results.push(result)
        process.stdout.write(`${result.pass ? 'PASS' : 'FAIL'} ${caseDefinition.id} trial ${String(trial)} (${String(result.durationMs)} ms)\n`)
      }
    }
    const finishedAt = new Date().toISOString()
    const report = await buildReport({
      suite,
      suitePath: options.suitePath,
      mode: options.mode,
      provider,
      model,
      harnessRoot: options.harnessRoot,
      pluginRoot,
      dshHome,
      patches,
      startedAt,
      finishedAt,
      results,
      serverInfo: firstServerInfo ?? null,
      ...(providerServer === undefined ? {} : { deterministicMetrics: providerServer.metrics }),
    })
    const paths = await writeReport(report, options.reportDirectory)
    process.stdout.write(`${report.pass ? 'PASS' : 'FAIL'} ${String(results.filter(result => result.pass).length)}/${String(results.length)} trials\n`)
    process.stdout.write(`JSON report: ${paths.jsonPath}\nMarkdown report: ${paths.markdownPath}\n`)
    return { report, paths }
  } finally {
    await providerServer?.close().catch(() => {})
    await fixture?.close().catch(() => {})
    for (const path of ownedTemporaryPaths) await rm(path, { recursive: true, force: true })
  }
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) {
      process.stdout.write(usage())
      return
    }
    const { report } = await runEvaluation(options)
    if (!report.pass) process.exitCode = 1
  } catch (error) {
    process.stderr.write(`Evaluation failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
