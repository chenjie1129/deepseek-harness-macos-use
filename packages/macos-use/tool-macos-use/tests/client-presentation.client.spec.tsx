// @vitest-environment jsdom
/** Browser-owned GUI-agent settings and per-step screenshot presentation. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { GuiAgentCardState } from '../src/client/controllers.ts'
import { GuiAgentCard, type GuiAgentCardProps } from '../src/client/SettingsCards.tsx'
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
    allowedApps: field(''),
    deniedApps: field(''),
    excludedScreenshotApps: field('Passwords'),
    confirmAppleScript: field('true'),
    confirmDestructiveActions: field('true'),
    singleActiveTask: field('true'),
    aborting: false,
    abortFailed: false,
  }
}

function agentProps(): GuiAgentCardProps {
  const state = agentState()
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
      'Allowed applications',
      'Denied applications',
      'Never capture these applications',
    ]) expect(screen.getByLabelText(label)).toBeTruthy()

    expect(screen.getByRole('switch', { name: 'Show step screenshots' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'Run automated browser headless' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Confirm arbitrary AppleScript' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Confirm destructive actions' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Allow only one active GUI task' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Abort active GUI tasks' })).toBeTruthy()
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
