/** Adapter from loop progress transitions to saved screenshots and the browser polling store. */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { createLiveScreenshotPreview } from './image.ts'
import type { TaskProgressEvent } from './loop.ts'
import {
  GuiTaskProgressStore,
  LIVE_PROGRESS_ACTION_MAX_CHARS,
  type LiveScreenshotPreview,
  type GuiTaskToolName,
} from './progress.ts'

function progressAction(action: Extract<TaskProgressEvent, { kind: 'decided' }>['action']): string {
  const projected = action.kind === 'type' && action.text !== undefined
    ? { ...action, text: `[redacted ${String(action.text.length)} typed characters]` }
    : action
  const encoded = JSON.stringify(projected)
  if (encoded.length <= LIVE_PROGRESS_ACTION_MAX_CHARS) return encoded
  const marker = '… [truncated]'
  return `${encoded.slice(0, LIVE_PROGRESS_ACTION_MAX_CHARS - marker.length)}${marker}`
}

async function livePreview(pngBase64: string): Promise<LiveScreenshotPreview | undefined> {
  try {
    return await createLiveScreenshotPreview(pngBase64)
  } catch {
    // Presentation artifacts are best-effort; task execution remains authoritative.
    return undefined
  }
}

/** Live reporter retained for the lifetime of one tool call. */
export interface TaskProgressReporter {
  readonly stepScreenshots: readonly (ImageAttachmentRef | undefined)[]
  onProgress(event: TaskProgressEvent, signal?: AbortSignal): Promise<void>
  finish(): void
}

/**
 * Attempt to save step captures immediately and publish a process-local phase snapshot.
 * Live previews never enter the session log; final results remain the durable
 * authority and carry the separately saved attachment references.
 * @param options - call identity, progress store, screenshot saver, and attachment name prefix.
 * @returns reporter that publishes phases and retains successfully saved step attachments.
 */
export function createTaskProgressReporter(options: {
  store: GuiTaskProgressStore
  exec: ToolRunContext
  toolName: GuiTaskToolName
  namePrefix: string
  saveScreenshot(pngBase64: string, name: string): Promise<ImageAttachmentRef>
}): TaskProgressReporter {
  const sessionId = options.exec.agent === undefined ? undefined : String(options.exec.agent.id)
  const callId = String(options.exec.callId)
  const screenshots: Array<ImageAttachmentRef | undefined> = []
  if (sessionId !== undefined) options.store.begin(sessionId, callId, options.toolName)

  return {
    stepScreenshots: screenshots,
    async onProgress(event): Promise<void> {
      if (event.kind === 'observed') {
        if (sessionId === undefined) return
        let preview: Awaited<ReturnType<typeof createLiveScreenshotPreview>> | undefined
        if (event.screenshotPngBase64 !== undefined) {
          preview = await livePreview(event.screenshotPngBase64)
        }
        options.store.update(sessionId, callId, {
          step: event.step,
          phase: 'observed',
          ...preview === undefined ? {} : { preview },
        })
        return
      }
      if (event.kind === 'decided') {
        if (sessionId !== undefined) {
          options.store.update(sessionId, callId, {
            step: event.step,
            phase: 'decided',
            action: progressAction(event.action),
          })
        }
        return
      }
      let preview: Awaited<ReturnType<typeof createLiveScreenshotPreview>> | undefined
      if (event.screenshotPngBase64 !== undefined) {
        const [screenshot, nextPreview] = await Promise.all([
          options.saveScreenshot(
            event.screenshotPngBase64,
            `${options.namePrefix}-step-${String(event.step)}.png`,
          ).catch(() => undefined),
          livePreview(event.screenshotPngBase64),
        ])
        if (screenshot !== undefined) screenshots[event.step - 1] = screenshot
        preview = nextPreview
      }
      if (sessionId !== undefined) {
        options.store.update(sessionId, callId, {
          step: event.step,
          phase: 'settled',
          ...event.entry.action === undefined ? {} : { action: progressAction(event.entry.action) },
          ...event.entry.outcome === undefined ? {} : { outcome: event.entry.outcome },
          ...preview === undefined ? {} : { preview },
        })
      }
    },
    finish(): void {
      if (sessionId !== undefined) options.store.finish(sessionId, callId)
    },
  }
}
