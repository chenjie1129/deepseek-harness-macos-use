/**
 * Vocabulary for the GUI-grounding vision model seam.
 * @module @deepseek-ai/dsh-gui-model/types
 */

/** Discriminates {@link GuiModelError} causes. */
export type GuiModelErrorCode =
  | 'GUI_MODEL_REQUEST_FAILED'
  | 'GUI_MODEL_MALFORMED_RESPONSE'

/** Raised by {@link GuiModelService.nextAction} on a failed request or an unparsable/invalid action. */
export class GuiModelError extends Error {
  constructor(message: string, readonly code: GuiModelErrorCode) {
    super(message)
    this.name = 'GuiModelError'
  }
}

/** One action kind the model may choose. */
export type GuiActionKind =
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'move'
  | 'drag'
  | 'type'
  | 'key'
  | 'scroll'
  | 'open_app'
  | 'focus_window'
  | 'wait'
  | 'done'

/**
 * One structured next action returned by {@link GuiModelService.nextAction}. Field presence depends on `kind`:
 * point actions need `x`/`y`; `drag` also needs `toX`/`toY`; `type` needs `text`; `key` needs `combo`;
 * `open_app`/`focus_window` need `app`; `scroll` needs `direction`; `wait` needs `ms`; `done` needs `summary`.
 */
export interface GuiAction {
  kind: GuiActionKind
  x?: number
  y?: number
  toX?: number
  toY?: number
  text?: string
  combo?: string
  app?: string
  windowTitle?: string
  direction?: 'up' | 'down' | 'left' | 'right'
  amount?: number
  ms?: number
  /** Present on `done`: a one-sentence summary of the outcome, shown to the caller. */
  summary?: string
  /** The model's one-sentence reasoning for this step, when it chose to include one. */
  reason?: string
}

/** One prior step, fed back to the model as running context for the next call. */
export interface GuiActionLogEntry {
  action: GuiAction
  /** Outcome note for this step, e.g. an error message when execution failed. */
  outcome?: string
}

/** Arguments to {@link GuiModelService.nextAction}. */
export interface NextActionRequest {
  /** Base64-encoded PNG bytes of the current screen or page. */
  screenshotPngBase64: string
  /** The natural-language task being accomplished. */
  task: string
  /** Prior steps in this task, oldest first. */
  history?: readonly GuiActionLogEntry[]
}
