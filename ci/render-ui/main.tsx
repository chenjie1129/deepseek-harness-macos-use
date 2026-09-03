import React from 'react'
import { createRoot } from 'react-dom/client'
import { GuiAgentCard, GuiModelCard } from '../src/client/SettingsCards.tsx'
import { GuiTaskView } from '../src/client/GuiTaskView.tsx'
import { en } from '../src/client/locales.ts'
import './page.css'

const t = (key: keyof typeof en): string => en[key]
const field = (text: string) => ({ text, overridden: false, invalid: false })

function modelState() {
  return {
    available: true,
    writable: true,
    dirty: false,
    invalid: false,
    saving: false,
    failed: false,
    apiKeyEnv: field('GUI_MODEL_API_KEY'),
    baseURL: field('https://vision.example.com/v1'),
    model: field('gui-vision-model'),
    maxOutputTokens: field('512'),
    apiKey: field(''),
    apiKeyConfigured: true,
    apiKeyWritable: true,
  }
}

function ModelCard() {
  const state = modelState()
  return <GuiModelCard {...{
    t,
    useGuiModelCard: (selector: (value: typeof state) => unknown) => selector(state),
    edit: () => {},
    resetField: () => {},
    save: () => {},
    discard: () => {},
    removeKey: () => {},
  } as any} />
}

function agentState(showStepScreenshots = true) {
  return {
    available: true,
    writable: true,
    dirty: false,
    invalid: false,
    saving: false,
    failed: false,
    defaultMaxSteps: field('20'),
    taskTimeoutMs: field('120000'),
    commandTimeoutMs: field('15000'),
    maxElementsPerSnapshot: field('250'),
    showStepScreenshots: field(String(showStepScreenshots)),
    browserHeadless: field('true'),
    browserAllowedDomains: field('example.com\ndocs.example.com'),
    browserDeniedDomains: field('accounts.example.com'),
    browserAllowPrivateNetwork: field('false'),
    allowedApps: field(''),
    deniedApps: field(''),
    readAppGrants: field('bundleId=com.apple.Safari\nbundleId=com.apple.Notes'),
    controlAppGrants: field('bundleId=com.apple.Safari\nbundleId=com.apple.Notes'),
    deniedAppIdentities: field('bundleId=com.apple.Passwords'),
    excludedScreenshotApps: field('Passwords\n1Password'),
    confirmDestructiveActions: field('true'),
    confirmEveryMutation: field('true'),
    singleActiveTask: field('true'),
    aborting: false,
    abortFailed: false,
  }
}

function AgentCard({ show = true }: { show?: boolean }) {
  const state = agentState(show)
  return <GuiAgentCard {...{
    t,
    useGuiAgentCard: (selector: (value: typeof state) => unknown) => selector(state),
    edit: () => {},
    resetField: () => {},
    save: () => {},
    discard: () => {},
    abort: () => {},
  } as any} />
}

const attachment = {
  attachmentId: 'fixture-step-1',
  mediaType: 'image/png',
  bytes: 18432,
  width: 640,
  height: 360,
  name: 'browser-use-task-step-1.png',
}

const fixtureImage = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#eef2ff"/><stop offset="1" stop-color="#dbeafe"/></linearGradient></defs>
    <rect width="640" height="360" rx="18" fill="url(#g)"/>
    <rect x="28" y="28" width="584" height="304" rx="14" fill="#fff" stroke="#94a3b8"/>
    <rect x="28" y="28" width="584" height="42" rx="14" fill="#1e293b"/>
    <circle cx="52" cy="49" r="6" fill="#fb7185"/><circle cx="72" cy="49" r="6" fill="#fbbf24"/><circle cx="92" cy="49" r="6" fill="#4ade80"/>
    <text x="52" y="116" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="26" font-weight="700" fill="#0f172a">Step 1 captured page</text>
    <text x="52" y="154" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="16" fill="#475569">Browser observation attached beside this step output</text>
    <rect x="52" y="190" width="536" height="18" rx="9" fill="#dbeafe"/><rect x="52" y="224" width="408" height="18" rx="9" fill="#e2e8f0"/>
    <rect x="52" y="270" width="144" height="38" rx="10" fill="#2563eb"/><text x="84" y="295" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="15" font-weight="600" fill="#fff">Continue</text>
  </svg>`)}`

function block(showImage: boolean) {
  return {
    kind: 'tool-result',
    seq: 2,
    time: 2000,
    callTime: 1000,
    callId: 'gui-fixture-1',
    call: { name: 'browser_use_task', argsRaw: '{"task":"Verify the checkout summary and continue"}' },
    content: [{ type: 'text', text: 'Completed' }],
    isError: false,
    meta: {
      verificationStatus: 'verified',
      content: showImage ? [
        { type: 'text', text: 'Step 1: navigate to checkout → page loaded' },
        { type: 'image', attachment },
        { type: 'text', text: 'Step 2: verify order summary → total matched' },
      ] : [
        { type: 'text', text: 'Step 1: navigate to checkout → page loaded' },
        { type: 'text', text: 'Step 2: verify order summary → total matched' },
        { type: 'text', text: 'Step screenshots are hidden by Plugin Configuration.' },
      ],
    },
    subCalls: [],
  }
}

function Task({ showImage }: { showImage: boolean }) {
  return <GuiTaskView {...{
    callId: 'gui-fixture-1',
    toolName: 'browser_use_task',
    block: block(showImage),
    openFile: () => {},
    t,
    loadImage: async () => fixtureImage,
  } as any} />
}

function App() {
  const mode = location.hash.slice(1) || 'config'
  if (mode === 'config') return (
    <main className="page wide">
      <div className="eyebrow">Settings · Plugins</div>
      <h1>Plugin Configuration</h1>
      <p className="lede">Every GUI-model and GUI-agent runtime control is available visually on this page.</p>
      <ul className="cards"><ModelCard /><AgentCard /></ul>
    </main>
  )
  const showImage = mode === 'on'
  return (
    <main className="page taskPage">
      <div className="eyebrow">Task output · Browser use</div>
      <h1>{showImage ? 'Step screenshots on' : 'Step screenshots off'}</h1>
      <div className={`settingState ${showImage ? 'on' : 'off'}`}>
        <span>Show step screenshots</span><strong>{showImage ? 'On (default)' : 'Off'}</strong>
      </div>
      <Task showImage={showImage} />
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
