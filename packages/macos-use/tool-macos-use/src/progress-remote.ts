/** Runtime-only Typert descriptors for GUI task progress snapshots. */

import {
  isGuiTaskProgressSnapshot,
  type GuiTaskProgressSnapshotResult,
} from './progress.ts'

/** Package identity used to bind the Host and browser Remote contributions. */
export const GUI_TASK_PROGRESS_REMOTE_PACKAGE = '@deepseek-ai/dsh-tool-macos-use'
/** Cordis service key for the Host-side progress endpoint. */
export const GUI_TASK_PROGRESS_REMOTE_SERVICE = 'guiTaskProgressRemote'
/** Typert namespace containing the progress snapshot method. */
export const GUI_TASK_PROGRESS_REMOTE_NAMESPACE = 'guiTaskProgress'

interface RuntimeSchema<T> {
  parse(value: unknown): T
}

function schema<T>(name: string, guard: (value: unknown) => value is T): RuntimeSchema<T> {
  return {
    parse(value: unknown): T {
      if (!guard(value)) throw new TypeError(`Invalid ${name}.`)
      return value
    },
  }
}

const stringSchema = schema<string>('GUI task progress string', (value): value is string => typeof value === 'string' && value !== '')
const snapshotSchema = schema<GuiTaskProgressSnapshotResult>(
  'GUI task progress snapshot',
  (value): value is GuiTaskProgressSnapshotResult => value === null || isGuiTaskProgressSnapshot(value),
)

/** Strict context-bound descriptor for the browser's read-only progress snapshot call. */
export const GUI_TASK_PROGRESS_REMOTE_DESCRIPTORS = [{
  id: `${GUI_TASK_PROGRESS_REMOTE_PACKAGE}#${GUI_TASK_PROGRESS_REMOTE_NAMESPACE}/snapshot`,
  service: GUI_TASK_PROGRESS_REMOTE_SERVICE,
  namespace: GUI_TASK_PROGRESS_REMOTE_NAMESPACE,
  method: 'snapshot',
  invocation: {
    kind: 'context' as const,
    context: 'agent',
    wire: 'agentId',
    codec: {
      mode: 'strict' as const,
      typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
      schema: stringSchema,
    },
  },
  parameters: [{
    name: 'callId',
    wire: 'callId',
    source: 'json' as const,
    codec: {
      mode: 'strict' as const,
      typeSymbol: '@deepseek-ai/dsh-llm/brand#CallId',
      schema: stringSchema,
    },
  }],
  result: {
    mode: 'strict' as const,
    typeSymbol: `${GUI_TASK_PROGRESS_REMOTE_PACKAGE}/progress#GuiTaskProgressSnapshotResult`,
    schema: snapshotSchema,
  },
}] as const

/** Host registration consumed by the current Harness Typert registry. */
export const GUI_TASK_PROGRESS_HOST_CONTRIBUTION = {
  package: GUI_TASK_PROGRESS_REMOTE_PACKAGE,
  face: 'host' as const,
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: GUI_TASK_PROGRESS_REMOTE_DESCRIPTORS,
}

/** Browser mount consumed by the generated Remote service. */
export const GUI_TASK_PROGRESS_REMOTE_CONTRIBUTION = {
  package: GUI_TASK_PROGRESS_REMOTE_PACKAGE,
  descriptors: GUI_TASK_PROGRESS_REMOTE_DESCRIPTORS,
}
