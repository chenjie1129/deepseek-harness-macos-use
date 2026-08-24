/**
 * Native macOS script builders for process/window discovery, pointer motion,
 * exact-window focus, and Accessibility snapshots. Discovery uses AppKit and
 * CoreGraphics, so it does not need Accessibility permission; semantic UI
 * enumeration and focus use System Events and therefore do.
 * @module @deepseek-ai/dsh-macos-use/native
 */

import { escapeAppleScriptString } from './applescript.ts'
import type { MacosWindow } from './types.ts'

/**
 * List foreground-capable applications through `NSWorkspace`.
 * @returns a JXA program that serializes application metadata as JSON.
 */
export function buildListAppsScript(): string {
  return String.raw`ObjC.import('AppKit');
const apps = $.NSWorkspace.sharedWorkspace.runningApplications;
const output = [];
const count = Number(ObjC.unwrap(apps.count));
for (let index = 0; index < count; index += 1) {
  const app = apps.objectAtIndex(index);
  if (Number(ObjC.unwrap(app.activationPolicy)) !== 0) continue;
  const name = ObjC.unwrap(app.localizedName);
  if (typeof name !== 'string' || name.length === 0) continue;
  const bundle = ObjC.unwrap(app.bundleIdentifier);
  output.push({
    name,
    ...(typeof bundle === 'string' ? { bundleId: bundle } : {}),
    pid: Number(ObjC.unwrap(app.processIdentifier)),
    active: Boolean(ObjC.unwrap(app.active)),
    hidden: Boolean(ObjC.unwrap(app.hidden)),
  });
}
JSON.stringify(output);`
}

/**
 * List ordinary on-screen windows through CoreGraphics.
 * @returns a JXA program that serializes layer-zero window metadata as JSON.
 */
export function buildListWindowsScript(): string {
  return String.raw`ObjC.import('CoreGraphics');
ObjC.import('Foundation');
const reference = $.CGWindowListCopyWindowInfo(17, 0);
const windows = ObjC.castRefToObject(reference);
const output = [];
const count = Number(ObjC.unwrap(windows.count));
for (let index = 0; index < count; index += 1) {
  const raw = ObjC.deepUnwrap(windows.objectAtIndex(index));
  const bounds = raw.kCGWindowBounds || {};
  const app = raw.kCGWindowOwnerName;
  const id = Number(raw.kCGWindowNumber);
  const pid = Number(raw.kCGWindowOwnerPID);
  const layer = Number(raw.kCGWindowLayer);
  const width = Number(bounds.Width);
  const height = Number(bounds.Height);
  if (typeof app !== 'string' || !Number.isFinite(id) || !Number.isFinite(pid)
      || layer !== 0 || !Number.isFinite(width) || !Number.isFinite(height)
      || width < 2 || height < 2) continue;
  output.push({
    id,
    app,
    pid,
    title: typeof raw.kCGWindowName === 'string' ? raw.kCGWindowName : '',
    bounds: {
      x: Number(bounds.X),
      y: Number(bounds.Y),
      width,
      height,
    },
    onScreen: raw.kCGWindowIsOnscreen !== false,
  });
}
JSON.stringify(output);`
}

/**
 * Resolve the main display's point-space bounds for Retina redaction scaling.
 * @returns a JXA program that serializes the main display bounds as JSON.
 */
export function buildMainDisplayBoundsScript(): string {
  return String.raw`ObjC.import('CoreGraphics');
const bounds = $.CGDisplayBounds($.CGMainDisplayID());
JSON.stringify({
  x: Number(bounds.origin.x),
  y: Number(bounds.origin.y),
  width: Number(bounds.size.width),
  height: Number(bounds.size.height),
});`
}

/**
 * Move the pointer without dispatching a click.
 * @param x - absolute destination x coordinate.
 * @param y - absolute destination y coordinate.
 * @returns a JXA CoreGraphics pointer-warp program.
 */
export function buildMovePointerScript(x: number, y: number): string {
  return String.raw`ObjC.import('CoreGraphics');
$.CGWarpMouseCursorPosition($.CGPointMake(${String(x)}, ${String(y)}));`
}

/**
 * Drag with CoreGraphics mouse events; duration is bounded by the caller.
 * @param x - absolute drag start x coordinate.
 * @param y - absolute drag start y coordinate.
 * @param toX - absolute destination x coordinate.
 * @param toY - absolute destination y coordinate.
 * @param durationMs - duration used to derive a bounded interpolation count.
 * @returns a JXA program posting a balanced mouse-down, drag, and mouse-up sequence.
 */
export function buildDragPointerScript(
  x: number,
  y: number,
  toX: number,
  toY: number,
  durationMs: number,
): string {
  const steps = Math.max(2, Math.min(100, Math.ceil(durationMs / 16)))
  const delaySeconds = durationMs / steps / 1000
  return String.raw`ObjC.import('CoreGraphics');
function post(type, x, y) {
  const event = $.CGEventCreateMouseEvent(null, type, $.CGPointMake(x, y), $.kCGMouseButtonLeft);
  $.CGEventPost($.kCGHIDEventTap, event);
}
post($.kCGEventMouseMoved, ${String(x)}, ${String(y)});
post($.kCGEventLeftMouseDown, ${String(x)}, ${String(y)});
for (let step = 1; step <= ${String(steps)}; step += 1) {
  const ratio = step / ${String(steps)};
  post($.kCGEventLeftMouseDragged,
    ${String(x)} + (${String(toX)} - ${String(x)}) * ratio,
    ${String(y)} + (${String(toY)} - ${String(y)}) * ratio);
  delay(${String(delaySeconds)});
}
post($.kCGEventLeftMouseUp, ${String(toX)}, ${String(toY)});`
}

/**
 * Bring one application/window to the front and raise the selected window.
 * @param window - exact discovered window to activate and raise.
 * @returns AppleScript source for the focus action.
 */
export function buildFocusWindowScript(window: MacosWindow): string {
  const app = escapeAppleScriptString(window.app)
  const title = escapeAppleScriptString(window.title)
  const select = title.length === 0
    ? 'set targetWindow to first window'
    : `set targetWindow to first window whose name is "${title}"`
  return 'tell application "System Events"\n'
    + `tell application process "${app}"\n`
    + 'set frontmost to true\n'
    + `${select}\n`
    + 'perform action "AXRaise" of targetWindow\n'
    + 'end tell\nend tell'
}

/**
 * Flatten one exact window's Accessibility tree into bounded JSON.
 * @param window - exact discovered window whose controls are enumerated.
 * @param maxElements - hard cap on returned Accessibility elements.
 * @returns JXA source that serializes bounded, redacted semantic state.
 */
export function buildWindowElementsScript(window: MacosWindow, maxElements: number): string {
  const app = JSON.stringify(window.app)
  const title = JSON.stringify(window.title)
  const expected = JSON.stringify(window.bounds)
  return String.raw`const systemEvents = Application('System Events');
const appName = ${app};
const expectedTitle = ${title};
const expectedBounds = ${expected};
const process = systemEvents.applicationProcesses.byName(appName);
if (!process.exists()) throw new Error('application is not running: ' + appName);
const windows = process.windows();
function read(fn, fallback) { try { const value = fn(); return value === undefined ? fallback : value; } catch (_) { return fallback; } }
function pair(value) { return Array.isArray(value) && value.length >= 2 ? [Number(value[0]), Number(value[1])] : null; }
function sameWindow(candidate) {
  const name = String(read(() => candidate.name(), ''));
  if (expectedTitle && name === expectedTitle) return true;
  const position = pair(read(() => candidate.position(), null));
  const size = pair(read(() => candidate.size(), null));
  return position !== null && size !== null
    && Math.abs(position[0] - expectedBounds.x) <= 2
    && Math.abs(position[1] - expectedBounds.y) <= 2
    && Math.abs(size[0] - expectedBounds.width) <= 2
    && Math.abs(size[1] - expectedBounds.height) <= 2;
}
let target = null;
for (let index = 0; index < windows.length; index += 1) {
  if (sameWindow(windows[index])) { target = windows[index]; break; }
}
if (target === null && windows.length > 0 && !expectedTitle) target = windows[0];
if (target === null) throw new Error('window is no longer available: ' + expectedTitle);
const output = [];
let truncated = false;
function scalar(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}
function visit(element, depth) {
  if (output.length >= ${String(maxElements)}) { truncated = true; return; }
  if (depth > 14) { truncated = true; return; }
  const role = String(read(() => element.role(), 'AXUnknown'));
  const subrole = scalar(read(() => element.subrole(), undefined));
  const title = scalar(read(() => element.title(), undefined));
  const description = scalar(read(() => element.description(), undefined));
  const help = scalar(read(() => element.help(), undefined));
  const secure = role === 'AXSecureTextField' || subrole === 'AXSecureTextField';
  const value = secure ? '[redacted]' : scalar(read(() => element.value(), undefined));
  const position = pair(read(() => element.position(), null));
  const size = pair(read(() => element.size(), null));
  output.push({
    role,
    ...(subrole === undefined ? {} : { subrole }),
    ...((title || description || help) ? { name: title || description || help } : {}),
    ...(value === undefined ? {} : { value }),
    ...(description === undefined ? {} : { description }),
    enabled: Boolean(read(() => element.enabled(), true)),
    ...(position === null || size === null ? {} : { bounds: { x: position[0], y: position[1], width: size[0], height: size[1] } }),
  });
  const children = read(() => element.uiElements(), []);
  for (let index = 0; index < children.length; index += 1) {
    visit(children[index], depth + 1);
    if (output.length >= ${String(maxElements)}) break;
  }
}
const children = read(() => target.uiElements(), []);
for (let index = 0; index < children.length; index += 1) visit(children[index], 0);
JSON.stringify({ elements: output, truncated });`
}
