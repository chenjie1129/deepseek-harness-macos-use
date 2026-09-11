// @vitest-environment jsdom
/** Browser-owned GUI-agent settings and per-step screenshot presentation. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import {
  validAppIdentityRules,
  validCredentialReference,
  validGuiModelBaseURL,
  type GuiAgentCardState,
  type GuiModelCardState,
} from '../src/client/controllers.ts'
import {
  GuiAgentCard,
  GuiModelCard,
  type GuiAgentCardProps,
  type GuiModelCardProps,
} from '../src/client/SettingsCards.tsx'
import { GuiTaskView, type GuiTaskViewProps, presentationContent } from '../src/client/GuiTaskView.tsx'
import { en, type MacosUseKey } from '../src/client/locales.ts'

const t = (key: MacosUseKey): string => en[key]

afterEach(cleanup)

const field = (text: string) => ({ text, overridden: false, invalid: false })

function agentState(): GuiAgentCardState {
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
    showStepScreenshots: field('true'),
    browserHeadless: field('true'),
    browserAllowedDomains: field(''),
    browserDeniedDomains: field(''),
    browserAllowPrivateNetwork: field('false'),
    browserBackend: field('playwright'),
    allowedApps: field(''),
    deniedApps: field(''),
    readAppGrants: field(''),
    controlAppGrants: field(''),
    deniedAppIdentities: field(''),
    excludedScreenshotApps: field('Passwords'),
    confirmDestructiveActions: field('true'),
    confirmEveryMutation: field('true'),
    singleActiveTask: field('true'),
    aborting: false,
    abortFailed: false,
  }
}

function agentProps(state = agentState()): GuiAgentCardProps {
  const useGuiAgentCard: GuiAgentCardProps['useGuiAgentCard'] = selector => selector(state)
  return {
    t,
    useGuiAgentCard,
    edit: vi.fn(),
    resetField: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
    abort: vi.fn(),
  } as unknown as GuiAgentCardProps
}

describe('GUI Agent configuration card', () => {
  it('exposes every agent setting visually and shows screenshots as enabled by default', () => {
    render(<GuiAgentCard {...agentProps()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show settings: GUI agent' }))

    for (const label of [
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
    ]) expect(screen.getByLabelText(label)).toBeTruthy()

    expect(screen.getByRole('switch', { name: 'Show step screenshots' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'Run automated browser headless' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Allow private-network browser targets' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: 'Confirm destructive actions' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Confirm every GUI mutation' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'Allow only one active GUI task' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Abort all active GUI tasks' })).toBeTruthy()
  })

  it('shows malformed precise app rules as invalid and blocks Save', () => {
    expect(validAppIdentityRules('bundle=com.apple.Safari')).toBe(false)
    expect(validAppIdentityRules('name=Safari | bundleId=com.apple.Safari | pid=41')).toBe(true)
    expect(validAppIdentityRules('name=Notes | name=Safari')).toBe(false)
    const state = agentState()
    state.dirty = true
    state.invalid = true
    state.readAppGrants = { ...field('bundle=com.apple.Safari'), invalid: true }
    render(<GuiAgentCard {...agentProps(state)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show settings: GUI agent' }))

    expect(screen.getByLabelText('Application read grants').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText(en['common.invalid'])).toBeTruthy()
    const agentSave = screen.getByRole('button', { name: 'Save' })
    expect(agentSave).toBeInstanceOf(HTMLButtonElement)
    if (!(agentSave instanceof HTMLButtonElement)) throw new TypeError('Save control is not a button')
    expect(agentSave.disabled).toBe(true)
  })

  it('keeps the emergency stop available while an ordinary settings Save is in flight', () => {
    const state = agentState()
    state.saving = true
    const props = agentProps(state)
    render(<GuiAgentCard {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show settings: GUI agent' }))

    const timeout = screen.getByLabelText('Task timeout (ms)')
    expect(timeout).toBeInstanceOf(HTMLInputElement)
    expect((timeout as HTMLInputElement).disabled).toBe(true)
    const abort = screen.getByRole<HTMLButtonElement>('button', { name: 'Abort all active GUI tasks' })
    expect(abort.disabled).toBe(false)
    fireEvent.click(abort)
    expect(props.abort).toHaveBeenCalledOnce()
  })
})

function modelState(): GuiModelCardState {
  return {
    available: true,
    writable: true,
    dirty: false,
    invalid: false,
    saving: false,
    failed: false,
    apiKeyEnv: field('GUI_MODEL_API_KEY'),
    baseURL: field(''),
    model: field(''),
    maxOutputTokens: field('512'),
    apiKey: field(''),
    apiKeyConfigured: false,
    apiKeyWritable: true,
  }
}

function modelProps(state = modelState()): GuiModelCardProps {
  const useGuiModelCard: GuiModelCardProps['useGuiModelCard'] = selector => selector(state)
  return {
    t,
    useGuiModelCard,
    edit: vi.fn(),
    resetField: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
    removeKey: vi.fn(),
  } as unknown as GuiModelCardProps
}

describe('GUI Model configuration card', () => {
  it('allows a blank first-run endpoint/model and rejects unsafe endpoint and credential syntax', () => {
    expect(validGuiModelBaseURL('')).toBe(true)
    expect(validGuiModelBaseURL('https://api.example.test/v1')).toBe(true)
    expect(validGuiModelBaseURL('http://127.0.0.1:9000/v1')).toBe(true)
    expect(validGuiModelBaseURL('http://[::ffff:127.0.0.1]:9000/v1')).toBe(true)
    expect(validGuiModelBaseURL('http://[::ffff:127.255.255.255]:9000/v1')).toBe(true)
    expect(validGuiModelBaseURL('http://[::ffff:7f0:1]/v1')).toBe(false)
    expect(validGuiModelBaseURL('http://[::ffff:7eff:ffff]/v1')).toBe(false)
    expect(validGuiModelBaseURL('http://provider.example/v1')).toBe(false)
    expect(validGuiModelBaseURL('https://user:pass@example.test/v1')).toBe(false)
    expect(validGuiModelBaseURL('https://example.test/v1?token=secret')).toBe(false)
    expect(validGuiModelBaseURL('file:///tmp/model')).toBe(false)
    expect(validCredentialReference('GUI_MODEL_API_KEY')).toBe(true)
    expect(validCredentialReference('not a ref')).toBe(false)

    const state = modelState()
    state.dirty = true
    state.invalid = true
    state.baseURL = { ...field('https://user:pass@example.test/v1'), invalid: true }
    render(<GuiModelCard {...modelProps(state)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show settings: GUI model' }))
    expect(screen.getByLabelText('Endpoint').getAttribute('aria-invalid')).toBe('true')
    const modelSave = screen.getByRole('button', { name: 'Save' })
    expect(modelSave).toBeInstanceOf(HTMLButtonElement)
    if (!(modelSave instanceof HTMLButtonElement)) throw new TypeError('Save control is not a button')
    expect(modelSave.disabled).toBe(true)
  })

  it('exposes a visual Remove key action for configured credentials', () => {
    const state = modelState()
    state.apiKeyConfigured = true
    const props = modelProps(state)
    render(<GuiModelCard {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show settings: GUI model' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove key' }))
    expect(props.removeKey).toHaveBeenCalledOnce()
  })

  it('disables every editable model field while a save is in flight', () => {
    const state = modelState()
    state.saving = true
    state.apiKeyConfigured = true
    render(<GuiModelCard {...modelProps(state)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show settings: GUI model' }))

    for (const label of ['API key', 'Credential reference', 'Endpoint', 'Model', 'Maximum response tokens']) {
      const input = screen.getByLabelText(label)
      expect(input).toBeInstanceOf(HTMLInputElement)
      expect((input as HTMLInputElement).disabled).toBe(true)
    }
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Remove key' }).disabled).toBe(true)
  })
})

const screenshot: ImageAttachmentRef = {
  attachmentId: 'step-1' as ImageAttachmentRef['attachmentId'],
  mediaType: 'image/png',
  bytes: 68,
  width: 2,
  height: 1,
  name: 'browser-use-task-step-1.png',
}

function taskBlock(meta: unknown): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 2,
    time: 2_000,
    callTime: 1_000,
    callId: 'gui-1',
    call: { name: 'browser_use_task', argsRaw: '{"task":"Verify screenshot output"}' },
    content: [{ type: 'text', text: 'Completed' }],
    isError: false,
    meta,
    subCalls: [],
  }
}

function taskProps(meta: unknown, loadImage: GuiTaskViewProps['loadImage']): GuiTaskViewProps {
  return {
    callId: 'gui-1',
    toolName: 'browser_use_task',
    block: taskBlock(meta),
    openFile: vi.fn(),
    t,
    loadImage,
  } as unknown as GuiTaskViewProps
}

describe('GUI task per-step output', () => {
  it('shows a bounded inline screenshot while the task is still running', async () => {
    const src = 'data:image/jpeg;base64,AAAA'
    const loadImage = vi.fn()
    const loadProgress = vi.fn(async () => ({
      callId: 'gui-1',
      toolName: 'browser_use_task' as const,
      revision: 2,
      active: true,
      steps: [{
        step: 1,
        phase: 'observed' as const,
        preview: { dataUrl: src, mediaType: 'image/jpeg' as const, bytes: 3, width: 1, height: 1 },
      }],
    }))
    render(<GuiTaskView {...{
      callId: 'gui-1',
      toolName: 'browser_use_task',
      block: {
        callId: 'gui-1',
        name: 'browser_use_task',
        argsRaw: '{"task":"Verify live screenshot"}',
        turn: 1,
        step: 1,
        time: 1_000,
        subCalls: [],
      },
      openFile: vi.fn(),
      t,
      loadImage,
      loadProgress,
    } as unknown as GuiTaskViewProps} />)

    expect(await screen.findByText('Step 1: Screenshot captured; model is deciding')).toBeTruthy()
    expect((await screen.findByRole('img', { name: 'GUI task step screenshot' })).getAttribute('src')).toBe(src)
    expect(screen.getByText('Running')).toBeTruthy()
    expect(loadImage).not.toHaveBeenCalled()
  })

  it('retains the last same-call preview when a hard abort has no durable presentation metadata', async () => {
    const src = 'data:image/jpeg;base64,AAAA'
    const loadProgress = vi.fn(async () => ({
      callId: 'gui-1',
      toolName: 'browser_use_task' as const,
      revision: 4,
      active: false,
      steps: [{
        step: 1,
        phase: 'settled' as const,
        action: '{"kind":"click","x":1,"y":2}',
        outcome: 'ok',
        preview: { dataUrl: src, mediaType: 'image/jpeg' as const, bytes: 3, width: 1, height: 1 },
      }],
    }))
    render(<GuiTaskView {...{
      callId: 'gui-1',
      toolName: 'browser_use_task',
      block: {
        ...taskBlock(undefined),
        isError: true,
        error: { code: 'ABORTED', message: 'tool call aborted' },
        content: [{ type: 'text', text: 'Error: tool call aborted' }],
      },
      openFile: vi.fn(),
      t,
      loadImage: vi.fn(),
      loadProgress,
    } as unknown as GuiTaskViewProps} />)

    expect(await screen.findByText(/Step 1: .* → ok/)).toBeTruthy()
    expect((await screen.findByRole('img', { name: 'GUI task step screenshot' })).getAttribute('src')).toBe(src)
    expect(screen.getByText('Error: tool call aborted')).toBeTruthy()
    expect(loadProgress).toHaveBeenCalledWith('gui-1')
  })

  it('renders step text and its authorized screenshot together', async () => {
    const src = 'data:image/png;base64,iVBORw0KGgo='
    const loadImage = vi.fn(async () => src)
    render(<GuiTaskView {...taskProps({ content: [
      { type: 'text', text: 'Step 1: click Save -> button clicked' },
      { type: 'image', attachment: screenshot },
    ] }, loadImage)} />)

    expect(screen.getByText('Step 1: click Save -> button clicked')).toBeTruthy()
    const image = await screen.findByRole('img', { name: 'browser-use-task-step-1.png' })
    expect(image.getAttribute('src')).toBe(src)
    expect(loadImage).toHaveBeenCalledWith(screenshot)
  })

  it('renders no screenshot when presentation metadata contains only text', () => {
    render(<GuiTaskView {...taskProps({ content: [
      { type: 'text', text: 'Screenshots disabled' },
    ] }, vi.fn())} />)
    expect(screen.getByText('Screenshots disabled')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('rejects malformed presentation metadata rather than loading an arbitrary URL', () => {
    expect(presentationContent({ content: [{ type: 'image', attachment: { url: 'https://evil.invalid' } }] }))
      .toBeUndefined()
  })
})
