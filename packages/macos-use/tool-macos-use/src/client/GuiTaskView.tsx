/** Inline task output for computer_use_task and browser_use_task, including per-step screenshots. */

import { useEffect, useMemo, useState } from 'react'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { GuiTaskProgressSnapshot, LiveScreenshotPreview } from '../progress.ts'
import css from './styles.module.css'

type PresentationBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; attachment: ImageAttachmentRef }

type VisibleBlock = PresentationBlock | { type: 'preview'; preview: LiveScreenshotPreview }

/** Session-authorized image loader injected into one GUI task view. */
export interface GuiTaskInjected {
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>
  /** Optional process-local snapshot bridge; absent on older/headless Harness surfaces. */
  loadProgress?: (callId: string) => Promise<GuiTaskProgressSnapshot | null>
}

/** Owner, locale, and injected props for an autonomous GUI task call. */
export type GuiTaskViewProps = ToolCallViewProps & PropsLocale<'macos-use'> & InjectFace<GuiTaskInjected>

function taskText(argsRaw: string | undefined, fallback: string): string {
  if (argsRaw === undefined) return fallback
  try {
    const task = (JSON.parse(argsRaw) as { task?: unknown }).task
    return typeof task === 'string' && task !== '' ? task : fallback
  } catch {
    return fallback
  }
}

function isImageRef(value: unknown): value is ImageAttachmentRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const ref = value as Record<string, unknown>
  return typeof ref.attachmentId === 'string'
    && typeof ref.mediaType === 'string'
    && typeof ref.bytes === 'number'
    && typeof ref.width === 'number'
    && typeof ref.height === 'number'
    && (ref.name === undefined || typeof ref.name === 'string')
}

/** Decode the plugin's UI-only text and image blocks from tool-result metadata. */
export function presentationContent(meta: unknown): readonly PresentationBlock[] | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const candidate = (meta as { content?: unknown }).content
  if (!Array.isArray(candidate)) return undefined
  const content: PresentationBlock[] = []
  for (const item of candidate) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return undefined
    const block = item as { type?: unknown; text?: unknown; attachment?: unknown }
    if (block.type === 'text' && typeof block.text === 'string') {
      content.push({ type: 'text', text: block.text })
      continue
    }
    if (block.type === 'image' && isImageRef(block.attachment)) {
      content.push({ type: 'image', attachment: block.attachment })
      continue
    }
    return undefined
  }
  return content
}

function presentationVerificationStatus(meta: unknown): string | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const value = (meta as { verificationStatus?: unknown }).verificationStatus
  return typeof value === 'string' ? value : undefined
}

function StepImage(props: Pick<GuiTaskViewProps, 'loadImage' | 't'> & { attachment: ImageAttachmentRef }) {
  const [src, setSrc] = useState<string>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    setSrc(undefined)
    setFailed(false)
    void props.loadImage(props.attachment).then(
      (value) => { if (live) setSrc(value) },
      () => { if (live) setFailed(true) },
    )
    return () => { live = false }
  }, [props.attachment, props.loadImage])
  if (failed) return <p className={css.imageState} role="status">{props.t('task.imageFailed')}</p>
  if (src === undefined) return <p className={css.imageState} role="status">{props.t('task.imageLoading')}</p>
  return (
    <a
      className={css.stepImageLink}
      href={src}
      target="_blank"
      rel="noreferrer"
      aria-label={props.t('task.openImage')}
    >
      <img
        className={css.stepImage}
        src={src}
        alt={props.attachment.name ?? props.t('task.image')}
        width={props.attachment.width}
        height={props.attachment.height}
      />
    </a>
  )
}

function LivePreviewImage(props: Pick<GuiTaskViewProps, 't'> & { preview: LiveScreenshotPreview }) {
  return (
    <a
      className={css.stepImageLink}
      href={props.preview.dataUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={props.t('task.openImage')}
    >
      <img
        className={css.stepImage}
        src={props.preview.dataUrl}
        alt={props.t('task.image')}
        width={props.preview.width}
        height={props.preview.height}
      />
    </a>
  )
}

function rawOutput(block: GuiTaskViewProps['block']): string {
  if (!('kind' in block)) return ''
  return block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2)).join('\n')
}

/** Render one running or settled desktop/browser task with inline step images. */
export function GuiTaskView(props: GuiTaskViewProps) {
  const [details, setDetails] = useState(false)
  const [progress, setProgress] = useState<GuiTaskProgressSnapshot | null>(null)
  const settled = 'kind' in props.block ? props.block : undefined
  const done = settled !== undefined
  const argsRaw = 'kind' in props.block ? props.block.call?.argsRaw : props.block.argsRaw
  const content = presentationContent(settled?.meta)
  const verificationStatus = presentationVerificationStatus(settled?.meta)
  const task = useMemo(() => taskText(argsRaw, props.callId), [argsRaw, props.callId])
  const status = settled === undefined ? 'task.running'
    : settled.error?.code === 'interrupted' ? 'task.stopped'
      : settled.isError ? 'task.failed'
        : verificationStatus === 'verified' ? 'task.verified'
          : verificationStatus === 'model_done_unverified' ? 'task.unverified'
            : verificationStatus === 'postcondition_failed' ? 'task.postconditionFailed'
              : verificationStatus === 'verification_error' ? 'task.verificationError'
                : verificationStatus === 'not_reached' ? 'task.stopped'
                  : 'task.completed'
  const title = props.toolName === 'browser_use_task' ? 'task.browser' : 'task.desktop'
  const loadProgress = props.loadProgress
  useEffect(() => {
    if (loadProgress === undefined) return
    let live = true
    let pending = false
    const refresh = (): void => {
      if (pending) return
      pending = true
      void loadProgress(props.callId).then(
        (snapshot) => {
          if (live && snapshot !== null) {
            setProgress(current => current === null || snapshot.revision >= current.revision ? snapshot : current)
          }
        },
        () => {},
      ).finally(() => { pending = false })
    }
    refresh()
    if (done) return () => { live = false }
    const timer = window.setInterval(refresh, 350)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [done, props.callId, loadProgress])
  const liveContent: VisibleBlock[] | undefined = progress === null ? undefined : progress.steps.flatMap((step) => {
    const prefix = `${props.t('task.step')} ${String(step.step)}:`
    const text = step.phase === 'observed'
      ? `${prefix} ${props.t('task.observing')}`
      : step.phase === 'decided'
        ? `${prefix} ${step.action ?? ''} → ${props.t('task.executing')}`
        : `${prefix} ${step.action ?? ''}${step.outcome === undefined ? '' : ` → ${step.outcome}`}`
    return [
      { type: 'text' as const, text },
      ...step.preview === undefined ? [] : [{ type: 'preview' as const, preview: step.preview }],
    ]
  })
  const visibleContent: readonly VisibleBlock[] | undefined = content ?? liveContent
  return (
    <div className={css.taskCard} data-state={settled?.isError === true ? 'error' : done ? 'done' : 'running'}>
      <button
        type="button"
        className={css.taskHeader}
        aria-expanded={details}
        aria-label={props.t(details ? 'task.hideDetails' : 'task.details')}
        onClick={() => { setDetails(value => !value) }}
      >
        <span className={css.stateDot} aria-hidden="true" />
        <strong>{props.t(title)}</strong>
        <span className={css.taskSummary}>{task}</span>
        <span className={css.taskStatus}>{props.t(status)}</span>
      </button>
      {details ? <pre className={css.taskArgs}>{argsRaw ?? ''}</pre> : null}
      {visibleContent !== undefined && visibleContent.length > 0 ? (
        <div className={css.taskOutput} data-tool-result-presentation>
          {visibleContent.map((item, index) => item.type === 'text'
            ? <p className={css.stepText} key={`text:${String(index)}`}>{item.text}</p>
            : item.type === 'image'
              ? <StepImage key={`image:${item.attachment.attachmentId}:${String(index)}`} {...props} attachment={item.attachment} />
              : <LivePreviewImage key={`preview:${String(index)}`} t={props.t} preview={item.preview} />)}
        </div>
      ) : done && rawOutput(props.block) !== '' ? (
        <pre className={css.rawOutput}>{rawOutput(props.block)}</pre>
      ) : null}
      {settled !== undefined && settled.isError && visibleContent !== undefined && visibleContent.length > 0
        && rawOutput(props.block) !== ''
        ? <pre className={css.rawOutput}>{rawOutput(props.block)}</pre>
        : null}
    </div>
  )
}
