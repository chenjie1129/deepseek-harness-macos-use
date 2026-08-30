import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildReport, writeReport } from '../src/report.mjs'

test('reports hash settings and redact secrets and inline image bytes', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-report-test-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const suitePath = join(root, 'suite.json')
  const home = join(root, 'home')
  const output = join(root, 'reports')
  await mkdir(home)
  await writeFile(suitePath, '{"formatVersion":1}', 'utf8')
  await writeFile(join(home, 'settings.yaml'), 'gui-model:\n  apiKey: never-print-this\n', 'utf8')
  const report = await buildReport({
    suite: { name: 'redaction', cases: [] },
    suitePath,
    mode: 'deterministic',
    provider: 'fake',
    model: 'fake',
    harnessRoot: root,
    pluginRoot: root,
    dshHome: home,
    patches: [suitePath],
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    results: [{
      caseId: 'one',
      trial: 1,
      pass: true,
      durationMs: 1,
      checks: [{ name: 'redaction', pass: true, details: { apiKey: 'never-print-this', screenshot: 'data:image/png;base64,AAAA' } }],
    }],
    serverInfo: { name: 'deepseek-harness-sdk-runtime', version: 'test' },
  })
  assert.match(report.run.settingsSha256, /^[a-f0-9]{64}$/)
  const paths = await writeReport(report, output)
  const text = await readFile(paths.jsonPath, 'utf8')
  assert.doesNotMatch(text, /never-print-this|base64,AAAA/)
  assert.match(text, /\[REDACTED\]/)
  assert.match(text, /\[IMAGE DATA OMITTED\]/)
})
