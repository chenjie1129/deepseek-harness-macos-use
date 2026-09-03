import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const outputDir = resolve(process.argv[2] ?? 'artifacts')
const harnessRootValue = process.env.HARNESS_ROOT
if (harnessRootValue === undefined || harnessRootValue === '') {
  throw new Error('HARNESS_ROOT is required')
}
const harnessRoot = resolve(harnessRootValue)
const playwrightEntry = resolve(
  harnessRoot,
  'packages/macos-use/browser-use/node_modules/playwright/index.mjs',
)
const { chromium } = await import(pathToFileURL(playwrightEntry).href)

await mkdir(outputDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 1,
})

const consoleProblems = []
const pageErrors = []
const requestFailures = []

function instrument(page) {
  page.on('console', message => {
    if (message.type() === 'warning' || message.type() === 'error') {
      consoleProblems.push({ type: message.type(), text: message.text() })
    }
  })
  page.on('pageerror', error => pageErrors.push(String(error)))
  page.on('requestfailed', request => {
    requestFailures.push({
      url: request.url(),
      error: request.failure()?.errorText,
    })
  })
}

const indexUrl = pathToFileURL(resolve(import.meta.dirname, 'index.html')).href
const overlays = page => page.locator(
  '[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay',
).count()
const horizontalOverflow = page => page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
)

async function openMode(mode, heading) {
  const page = await context.newPage()
  instrument(page)
  await page.goto(`${indexUrl}#${mode}`, { waitUntil: 'load' })
  assert.equal(new URL(page.url()).hash, `#${mode}`, `wrong URL mode for ${mode}`)
  await page.getByRole('heading', { name: heading, exact: true }).waitFor({ state: 'visible' })
  return page
}

const report = {
  componentSource: {
    settingsCards: 'packages/macos-use/tool-macos-use/src/client/SettingsCards.tsx',
    guiTaskView: 'packages/macos-use/tool-macos-use/src/client/GuiTaskView.tsx',
  },
  captures: {},
  consoleProblems,
  pageErrors,
  requestFailures,
}

try {
  const configPage = await openMode('config', 'Plugin Configuration')
  await configPage.getByRole('button', { name: 'Show settings: GUI model' }).click()
  await configPage.getByRole('button', { name: 'Show settings: GUI agent' }).click()

  const labels = [
    'API key',
    'Credential reference',
    'Endpoint',
    'Model',
    'Maximum response tokens',
    'Maximum steps per task',
    'Task timeout (ms)',
    'macOS command timeout (ms)',
    'Elements per window snapshot',
    'Allowed browser domains',
    'Denied browser domains',
    'Application read grants',
    'Application control grants',
    'Denied application identities',
    'Allowed applications',
    'Denied applications',
    'Never capture these applications',
  ]
  const switches = [
    'Show step screenshots',
    'Run automated browser headless',
    'Allow private-network browser targets',
    'Confirm destructive actions',
    'Confirm every GUI mutation',
    'Allow only one active GUI task',
  ]

  for (const label of labels) {
    assert.equal(
      await configPage.getByLabel(label, { exact: true }).count(),
      1,
      `missing or ambiguous ${label}`,
    )
  }
  for (const label of switches) {
    assert.equal(
      await configPage.getByRole('switch', { name: label, exact: true }).count(),
      1,
      `missing ${label}`,
    )
  }
  assert.equal(await configPage.getByRole('button', { name: 'Remove key' }).count(), 1)

  const screenshotSwitch = configPage.getByRole('switch', {
    name: 'Show step screenshots',
  })
  assert.equal(await screenshotSwitch.getAttribute('aria-checked'), 'true')
  const mutationSwitch = configPage.getByRole('switch', {
    name: 'Confirm every GUI mutation',
  })
  assert.equal(await mutationSwitch.getAttribute('aria-checked'), 'true')

  const emergencyStop = configPage.getByRole('button', {
    name: 'Abort all active GUI tasks',
  })
  assert.equal(await emergencyStop.count(), 1)
  assert.equal(await emergencyStop.isEnabled(), true)
  assert.equal(await overlays(configPage), 0)
  assert.equal(await horizontalOverflow(configPage), false)

  report.captures.config = {
    screenshot: resolve(outputDir, '01-plugin-configuration-default-on.png'),
    screenshotSwitch: 'on',
    emergencyStopEnabled: true,
    visualControls: labels.length + switches.length + 2,
  }
  await configPage.screenshot({
    path: report.captures.config.screenshot,
    fullPage: true,
  })
  await configPage.close()

  const onPage = await openMode('on', 'Step screenshots on')
  const stepImage = onPage.getByRole('img', {
    name: 'browser-use-task-step-1.png',
  })
  await stepImage.waitFor({ state: 'visible' })
  await onPage.waitForFunction(() => document.querySelector('img')?.complete === true)

  assert.equal(await onPage.getByRole('img').count(), 1)
  assert.equal(await onPage.getByText(/^Step [12]:/).count(), 2)
  assert.ok(await stepImage.evaluate(image => image.naturalWidth > 0))
  assert.equal(await overlays(onPage), 0)
  assert.equal(await horizontalOverflow(onPage), false)

  report.captures.on = {
    screenshot: resolve(outputDir, '02-task-step-screenshot-on.png'),
    imageCount: 1,
    stepCount: 2,
  }
  await onPage.screenshot({
    path: report.captures.on.screenshot,
    fullPage: true,
  })
  await onPage.close()

  const offPage = await openMode('off', 'Step screenshots off')
  assert.equal(await offPage.getByRole('img').count(), 0)
  assert.equal(await offPage.getByText(/^Step [12]:/).count(), 2)
  assert.equal(
    await offPage
      .getByText('Step screenshots are hidden by Plugin Configuration.')
      .count(),
    1,
  )
  assert.equal(await overlays(offPage), 0)
  assert.equal(await horizontalOverflow(offPage), false)

  report.captures.off = {
    screenshot: resolve(outputDir, '03-task-step-screenshot-off.png'),
    imageCount: 0,
    stepCount: 2,
  }
  await offPage.screenshot({
    path: report.captures.off.screenshot,
    fullPage: true,
  })
  await offPage.close()
} finally {
  await browser.close()
}

assert.deepEqual(consoleProblems, [], 'browser console was not clean')
assert.deepEqual(pageErrors, [], 'uncaught page errors occurred')
assert.deepEqual(requestFailures, [], 'browser requests failed')

await writeFile(
  resolve(outputDir, 'render-report.json'),
  `${JSON.stringify(report, null, 2)}\n`,
)
