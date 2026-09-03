/**
 * Native macOS script builders for process/window discovery, pointer motion,
 * exact-window focus, and Accessibility snapshots. Discovery uses AppKit and
 * CoreGraphics, so it does not need Accessibility permission; semantic UI
 * enumeration and focus use System Events and therefore do.
 * @module @deepseek-ai/dsh-macos-use/native
 */

import { escapeAppleScriptString, parseKeyCombo } from './applescript.ts'
import type {
  KeyModifier,
  MacosWindow,
  MouseButton,
  ResolvedMacosApplication,
} from './types.ts'

const JXA_MODIFIER_FLAG: Record<KeyModifier, string> = {
  command: '$.kCGEventFlagMaskCommand',
  control: '$.kCGEventFlagMaskControl',
  option: '$.kCGEventFlagMaskAlternate',
  shift: '$.kCGEventFlagMaskShift',
}

const JXA_MODIFIER_NAME: Record<KeyModifier, string> = {
  command: 'command down',
  control: 'control down',
  option: 'option down',
  shift: 'shift down',
}

const JXA_SCROLL_KEY_CODE: Readonly<Record<'up' | 'down' | 'left' | 'right', number>> = {
  up: 126,
  down: 125,
  left: 123,
  right: 124,
}

function buildExactTargetJxaGuard(window: MacosWindow): string {
  const expected = JSON.stringify(window)
  return String.raw`ObjC.import('CoreGraphics');
ObjC.import('AppKit');
const expectedTarget = ${expected};
function unwrap(value, fallback) { try { const output = ObjC.unwrap(value); return output === undefined ? fallback : output; } catch (_) { return fallback; } }
const frontmost = $.NSWorkspace.sharedWorkspace.frontmostApplication;
if (frontmost === null || frontmost === undefined) throw new Error('target process is no longer frontmost');
const frontName = String(unwrap(frontmost.localizedName, ''));
const frontPid = Number(unwrap(frontmost.processIdentifier, -1));
const frontBundle = String(unwrap(frontmost.bundleIdentifier, ''));
if (frontPid !== expectedTarget.pid || frontName !== expectedTarget.app
    || (expectedTarget.bundleId !== undefined && frontBundle !== expectedTarget.bundleId)) {
  throw new Error('target process identity changed before pointer input');
}
const reference = $.CGWindowListCopyWindowInfo(17, 0);
const windows = ObjC.castRefToObject(reference);
let firstProcessWindowId;
let exactMatches = 0;
const count = Number(unwrap(windows.count, 0));
for (let index = 0; index < count; index += 1) {
  const raw = ObjC.deepUnwrap(windows.objectAtIndex(index));
  const pid = Number(raw.kCGWindowOwnerPID);
  const layer = Number(raw.kCGWindowLayer);
  if (pid !== expectedTarget.pid || layer !== 0 || raw.kCGWindowIsOnscreen === false) continue;
  const id = Number(raw.kCGWindowNumber);
  if (firstProcessWindowId === undefined) firstProcessWindowId = id;
  const bounds = raw.kCGWindowBounds || {};
  if (id === expectedTarget.id
      && String(raw.kCGWindowOwnerName || '') === expectedTarget.app
      && String(raw.kCGWindowName || '') === expectedTarget.title
      && Number(bounds.X) === expectedTarget.bounds.x
      && Number(bounds.Y) === expectedTarget.bounds.y
      && Number(bounds.Width) === expectedTarget.bounds.width
      && Number(bounds.Height) === expectedTarget.bounds.height) exactMatches += 1;
}
if (exactMatches !== 1 || firstProcessWindowId !== expectedTarget.id) {
  throw new Error('target window is stale, ambiguous, or no longer frontmost');
}
`
}

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
  return buildWindowQueryScript(false)
}

/**
 * Read the foreground process and ordinary window list in one native query.
 * The foreground identity is checked on both sides of CoreGraphics' window
 * snapshot so a focus transition fails closed instead of producing a mixed
 * completion state.
 * @returns a JXA program that serializes the fenced completion snapshot.
 */
export function buildCompletionStateScript(): string {
  return String.raw`ObjC.import('CoreGraphics');
ObjC.import('AppKit');
ObjC.import('Foundation');
function unwrap(value, fallback) {
  try {
    const output = ObjC.unwrap(value);
    return output === undefined ? fallback : output;
  } catch (_) {
    return fallback;
  }
}
function readFrontmost() {
  const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  if (app === null || app === undefined) throw new Error('no frontmost application process');
  const name = String(unwrap(app.localizedName, ''));
  const bundle = String(unwrap(app.bundleIdentifier, ''));
  const pid = Number(unwrap(app.processIdentifier, -1));
  if (name.length === 0 || !Number.isInteger(pid) || pid <= 0) {
    throw new Error('invalid frontmost application identity');
  }
  return { name, ...(bundle.length > 0 ? { bundleId: bundle } : {}), pid };
}
function sameProcess(left, right) {
  return left.name === right.name && left.pid === right.pid
    && String(left.bundleId || '') === String(right.bundleId || '');
}
const before = readFrontmost();
const reference = $.CGWindowListCopyWindowInfo(17, 0);
const nativeWindows = ObjC.castRefToObject(reference);
const windows = [];
const count = Number(unwrap(nativeWindows.count, 0));
for (let index = 0; index < count; index += 1) {
  const raw = ObjC.deepUnwrap(nativeWindows.objectAtIndex(index));
  const bounds = raw.kCGWindowBounds || {};
  const app = typeof raw.kCGWindowOwnerName === 'string' ? raw.kCGWindowOwnerName : '';
  const id = Number(raw.kCGWindowNumber);
  const pid = Number(raw.kCGWindowOwnerPID);
  const runningApp = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
  const bundle = runningApp.bundleIdentifier === undefined ? undefined : ObjC.unwrap(runningApp.bundleIdentifier);
  const layer = Number(raw.kCGWindowLayer);
  const x = Number(bounds.X);
  const y = Number(bounds.Y);
  const width = Number(bounds.Width);
  const height = Number(bounds.Height);
  if (app.length === 0 || !Number.isFinite(id) || !Number.isFinite(pid)
      || layer !== 0 || !Number.isFinite(x) || !Number.isFinite(y)
      || !Number.isFinite(width) || !Number.isFinite(height)
      || width < 2 || height < 2) continue;
  windows.push({
    id,
    app,
    ...(typeof bundle === 'string' ? { bundleId: bundle } : {}),
    pid,
    title: typeof raw.kCGWindowName === 'string' ? raw.kCGWindowName : '',
    bounds: { x, y, width, height },
    onScreen: raw.kCGWindowIsOnscreen !== false,
  });
}
const after = readFrontmost();
if (!sameProcess(before, after)) throw new Error('frontmost process changed during completion snapshot');
JSON.stringify({ frontmostProcess: after, windows, observedAt: new Date().toISOString() });`
}

/**
 * List every visible layer, including desktop elements, needed to redact full-screen pixels safely.
 * @returns a JXA program that serializes all visible window layers as JSON.
 */
export function buildMaskingWindowsScript(): string {
  return buildWindowQueryScript(true)
}

function buildWindowQueryScript(includeAllLayers: boolean): string {
  return String.raw`ObjC.import('CoreGraphics');
ObjC.import('AppKit');
ObjC.import('Foundation');
const includeAllLayers = ${String(includeAllLayers)};
const reference = $.CGWindowListCopyWindowInfo(includeAllLayers ? 1 : 17, 0);
const windows = ObjC.castRefToObject(reference);
const output = [];
const count = Number(ObjC.unwrap(windows.count));
for (let index = 0; index < count; index += 1) {
  const raw = ObjC.deepUnwrap(windows.objectAtIndex(index));
  const bounds = raw.kCGWindowBounds || {};
  const app = typeof raw.kCGWindowOwnerName === 'string' ? raw.kCGWindowOwnerName : '';
  const id = Number(raw.kCGWindowNumber);
  const pid = Number(raw.kCGWindowOwnerPID);
  const runningApp = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
  const bundle = runningApp.bundleIdentifier === undefined ? undefined : ObjC.unwrap(runningApp.bundleIdentifier);
  const layer = Number(raw.kCGWindowLayer);
  const x = Number(bounds.X);
  const y = Number(bounds.Y);
  const width = Number(bounds.Width);
  const height = Number(bounds.Height);
  if ((!includeAllLayers && app.length === 0) || !Number.isFinite(id) || !Number.isFinite(pid)
      || (!includeAllLayers && layer !== 0) || !Number.isFinite(x) || !Number.isFinite(y)
      || !Number.isFinite(width) || !Number.isFinite(height)
      || width < 2 || height < 2) continue;
  output.push({
    id,
    app,
    ...(typeof bundle === 'string' ? { bundleId: bundle } : {}),
    ...(includeAllLayers ? { layer } : {}),
    pid,
    title: typeof raw.kCGWindowName === 'string' ? raw.kCGWindowName : '',
    bounds: {
      x,
      y,
      width,
      height,
    },
    onScreen: raw.kCGWindowIsOnscreen !== false,
  });
}
JSON.stringify(output);`
}

/**
 * Resolve the frontmost process with both its display name and stable pid.
 * @returns a JXA program that serializes the exact foreground process identity as JSON.
 */
export function buildFrontmostProcessScript(): string {
  return String.raw`ObjC.import('AppKit');
const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
if (app === null || app === undefined || app.localizedName === undefined
    || app.processIdentifier === undefined) throw new Error('no frontmost application process');
const name = ObjC.unwrap(app.localizedName);
const bundle = ObjC.unwrap(app.bundleIdentifier);
const pid = Number(ObjC.unwrap(app.processIdentifier));
if (typeof name !== 'string' || name.length === 0 || !Number.isInteger(pid)) {
  throw new Error('invalid frontmost application identity');
}
JSON.stringify({
  name,
  ...(typeof bundle === 'string' ? { bundleId: bundle } : {}),
  pid,
});`
}

/**
 * Resolve the main display's point-space bounds for Retina redaction scaling.
 * @returns a JXA program that serializes the main display bounds as JSON.
 */
export function buildMainDisplayBoundsScript(): string {
  return String.raw`ObjC.import('CoreGraphics');
const id = Number($.CGMainDisplayID());
const bounds = $.CGDisplayBounds(id);
JSON.stringify({
  id,
  bounds: {
    x: Number(bounds.origin.x),
    y: Number(bounds.origin.y),
    width: Number(bounds.size.width),
    height: Number(bounds.size.height),
  },
});`
}

/**
 * Move the pointer without dispatching a click.
 * @param x - absolute destination x coordinate.
 * @param y - absolute destination y coordinate.
 * @param window - optional exact window identity to revalidate atomically before motion.
 * @returns a JXA CoreGraphics pointer-warp program.
 */
export function buildMovePointerScript(x: number, y: number, window?: MacosWindow): string {
  const guard = window === undefined ? "ObjC.import('CoreGraphics');\n" : buildExactTargetJxaGuard(window)
  return String.raw`${guard}
$.CGWarpMouseCursorPosition($.CGPointMake(${String(x)}, ${String(y)}));`
}

/**
 * Build an exact-ID guarded CoreGraphics click with event flags instead of persistent modifier key-down state.
 * @param window - byte-exact observed window identity and bounds to revalidate.
 * @param x - absolute horizontal screen coordinate.
 * @param y - absolute vertical screen coordinate.
 * @param options - button, click count, and transient modifier flags.
 * @returns a guarded JXA program posting a balanced click sequence.
 */
export function buildGuardedClickJxaScript(
  window: MacosWindow,
  x: number,
  y: number,
  options: { button?: MouseButton; doubleClick?: boolean; modifiers?: readonly KeyModifier[] },
): string {
  const right = options.button === 'right'
  const down = right ? '$.kCGEventRightMouseDown' : '$.kCGEventLeftMouseDown'
  const up = right ? '$.kCGEventRightMouseUp' : '$.kCGEventLeftMouseUp'
  const button = right ? '$.kCGMouseButtonRight' : '$.kCGMouseButtonLeft'
  const count = right || options.doubleClick !== true ? 1 : 2
  const flags = (options.modifiers ?? []).map(modifier => JXA_MODIFIER_FLAG[modifier]).join(' | ') || '0'
  return String.raw`${buildExactTargetJxaGuard(window)}
const clickPoint = $.CGPointMake(${String(x)}, ${String(y)});
const clickFlags = ${flags};
const clickButton = ${button};
function postClick(type, clickState) {
  const event = $.CGEventCreateMouseEvent(null, type, clickPoint, clickButton);
  if (clickFlags !== 0) $.CGEventSetFlags(event, clickFlags);
  $.CGEventSetIntegerValueField(event, $.kCGMouseEventClickState, clickState);
  $.CGEventPost($.kCGHIDEventTap, event);
}
let clickIsDown = false;
try {
  for (let clickIndex = 1; clickIndex <= ${String(count)}; clickIndex += 1) {
    postClick(${down}, clickIndex);
    clickIsDown = true;
    postClick(${up}, clickIndex);
    clickIsDown = false;
  }
} finally {
  if (clickIsDown) postClick(${up}, ${String(count)});
}`
}

/**
 * Build exact-ID guarded literal System Events typing in the same JXA program.
 * @param window - byte-exact observed window identity and bounds to revalidate.
 * @param text - literal text delivered after the target guard succeeds.
 * @returns a guarded JXA program that fails before typing when the target changed.
 */
export function buildGuardedTypeJxaScript(window: MacosWindow, text: string): string {
  return String.raw`${buildExactTargetJxaGuard(window)}
const systemEvents = Application('System Events');
systemEvents.keystroke(${JSON.stringify(text)});`
}

/**
 * Build an exact-ID guarded key press in the same JXA program.
 * @param window - byte-exact observed window identity and bounds to revalidate.
 * @param combo - one named or printable key with optional modifiers.
 * @returns a guarded JXA program that fails before the key press when the target changed.
 */
export function buildGuardedKeyJxaScript(window: MacosWindow, combo: string): string {
  const parsed = parseKeyCombo(combo)
  const names = parsed.modifiers.map(modifier => JXA_MODIFIER_NAME[modifier])
  const options = names.length === 0 ? '' : `, { using: ${JSON.stringify(names)} }`
  const call = parsed.keyCode === undefined
    ? `systemEvents.keystroke(${JSON.stringify(parsed.character)}${options});`
    : `systemEvents.keyCode(${String(parsed.keyCode)}${options});`
  return String.raw`${buildExactTargetJxaGuard(window)}
const systemEvents = Application('System Events');
${call}`
}

/**
 * Build exact-ID guarded bounded scroll keystrokes in the same JXA program.
 * @param window - byte-exact observed window identity and bounds to revalidate.
 * @param direction - arrow-key direction.
 * @param amount - requested repetition count, clamped to 1 through 50.
 * @returns a guarded JXA program that fails before scrolling when the target changed.
 */
export function buildGuardedScrollJxaScript(
  window: MacosWindow,
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number,
): string {
  const code = JXA_SCROLL_KEY_CODE[direction]
  const steps = Math.max(1, Math.min(50, Math.trunc(amount)))
  return String.raw`${buildExactTargetJxaGuard(window)}
const systemEvents = Application('System Events');
for (let step = 0; step < ${String(steps)}; step += 1) systemEvents.keyCode(${String(code)});`
}

/**
 * Drag with CoreGraphics mouse events; duration is bounded by the caller.
 * @param x - absolute drag start x coordinate.
 * @param y - absolute drag start y coordinate.
 * @param toX - absolute destination x coordinate.
 * @param toY - absolute destination y coordinate.
 * @param durationMs - duration used to derive a bounded interpolation count.
 * @param window - optional exact window identity to revalidate atomically before drag input.
 * @returns a JXA program posting a balanced mouse-down, drag, and mouse-up sequence.
 */
export function buildDragPointerScript(
  x: number,
  y: number,
  toX: number,
  toY: number,
  durationMs: number,
  window?: MacosWindow,
): string {
  const steps = Math.max(2, Math.min(100, Math.ceil(durationMs / 16)))
  const delaySeconds = durationMs / steps / 1000
  const guard = window === undefined ? "ObjC.import('CoreGraphics');\n" : buildExactTargetJxaGuard(window)
  return String.raw`${guard}
function post(type, x, y) {
  const event = $.CGEventCreateMouseEvent(null, type, $.CGPointMake(x, y), $.kCGMouseButtonLeft);
  $.CGEventPost($.kCGHIDEventTap, event);
}
let pointerX = ${String(x)};
let pointerY = ${String(y)};
let mouseDown = false;
try {
  post($.kCGEventMouseMoved, pointerX, pointerY);
  post($.kCGEventLeftMouseDown, pointerX, pointerY);
  mouseDown = true;
  for (let step = 1; step <= ${String(steps)}; step += 1) {
    const ratio = step / ${String(steps)};
    pointerX = ${String(x)} + (${String(toX)} - ${String(x)}) * ratio;
    pointerY = ${String(y)} + (${String(toY)} - ${String(y)}) * ratio;
    post($.kCGEventLeftMouseDragged, pointerX, pointerY);
    delay(${String(delaySeconds)});
  }
} finally {
  if (mouseDown) post($.kCGEventLeftMouseUp, pointerX, pointerY);
}
`
}

/**
 * Resolve every Launch Services URL registered for an exact bundle identifier.
 * @param bundleId - exact application bundle identifier to query.
 * @returns a JXA program that serializes registered application paths as JSON.
 */
export function buildApplicationUrlsForBundleScript(bundleId: string): string {
  return String.raw`ObjC.import('CoreServices');
ObjC.import('Foundation');
const reference = $.LSCopyApplicationURLsForBundleIdentifier(${JSON.stringify(bundleId)}, null);
const output = [];
if (reference !== null && reference !== undefined) {
  const urls = ObjC.castRefToObject(reference);
  const count = Number(ObjC.unwrap(urls.count));
  for (let index = 0; index < count; index += 1) {
    const path = ObjC.unwrap(urls.objectAtIndex(index).path);
    if (typeof path === 'string' && path.length > 0) output.push(path);
  }
}
JSON.stringify(output);`
}

/**
 * Inspect candidate application-bundle paths without launching them.
 * @param paths - candidate filesystem paths returned by Launch Services or standard application roots.
 * @returns a JXA program that serializes valid bundle name, identifier, and canonical path tuples.
 */
export function buildApplicationBundleInspectionScript(paths: readonly string[]): string {
  return String.raw`ObjC.import('Foundation');
const candidates = ${JSON.stringify(paths)};
const output = [];
for (let index = 0; index < candidates.length; index += 1) {
  const url = $.NSURL.fileURLWithPath(candidates[index]).URLByResolvingSymlinksInPath;
  const bundle = $.NSBundle.bundleWithURL(url);
  if (bundle === null || bundle === undefined) continue;
  const bundleId = ObjC.unwrap(bundle.bundleIdentifier);
  if (typeof bundleId !== 'string' || bundleId.length === 0) continue;
  const info = bundle.infoDictionary;
  const display = info === null || info === undefined ? undefined : ObjC.unwrap(info.objectForKey('CFBundleDisplayName'));
  const fallback = info === null || info === undefined ? undefined : ObjC.unwrap(info.objectForKey('CFBundleName'));
  const path = ObjC.unwrap(url.path);
  const name = typeof display === 'string' && display.length > 0
    ? display
    : typeof fallback === 'string' && fallback.length > 0 ? fallback : undefined;
  if (typeof path === 'string' && typeof name === 'string') output.push({ name, bundleId, path });
}
JSON.stringify(output);`
}

/**
 * Revalidate and launch one exact bundle path in the same NSWorkspace program.
 * @param application - previously resolved application identity to compare immediately before launch.
 * @returns a JXA program that launches only the still-matching bundle and serializes its identity.
 */
export function buildLaunchExactApplicationScript(application: ResolvedMacosApplication): string {
  return String.raw`ObjC.import('AppKit');
ObjC.import('Foundation');
const expected = ${JSON.stringify(application)};
const url = $.NSURL.fileURLWithPath(expected.path).URLByResolvingSymlinksInPath;
const bundle = $.NSBundle.bundleWithURL(url);
if (bundle === null || bundle === undefined) throw new Error('application bundle disappeared before launch');
const bundleId = ObjC.unwrap(bundle.bundleIdentifier);
const info = bundle.infoDictionary;
const display = info === null || info === undefined ? undefined : ObjC.unwrap(info.objectForKey('CFBundleDisplayName'));
const fallback = info === null || info === undefined ? undefined : ObjC.unwrap(info.objectForKey('CFBundleName'));
const name = typeof display === 'string' && display.length > 0 ? display : fallback;
const path = ObjC.unwrap(url.path);
if (path !== expected.path || bundleId !== expected.bundleId || name !== expected.name) {
  throw new Error('application bundle identity changed before launch');
}
if (!Boolean(ObjC.unwrap($.NSWorkspace.sharedWorkspace.openURL(url)))) {
  throw new Error('Launch Services refused the exact application bundle URL');
}
JSON.stringify({ name, bundleId, path });`
}

/**
 * Bring one application/window to the front and raise the selected window.
 * @param window - exact discovered window to activate and raise.
 * @returns AppleScript source for the focus action.
 */
export function buildFocusWindowScript(window: MacosWindow): string {
  const app = escapeAppleScriptString(window.app)
  const title = escapeAppleScriptString(window.title)
  const bundleCheck = window.bundleId === undefined
    ? ''
    : `if (bundle identifier of targetProcess) is not "${escapeAppleScriptString(window.bundleId)}" then error "target process bundle changed"\n`
  const { x, y, width, height } = window.bounds
  return 'on nearValue(leftValue, rightValue)\n'
    + 'return ((leftValue - rightValue) is less than or equal to 2) and ((rightValue - leftValue) is less than or equal to 2)\n'
    + 'end nearValue\n'
    + 'tell application "System Events"\n'
    + `set matchingProcesses to every application process whose unix id is ${String(window.pid)}\n`
    + 'if (count matchingProcesses) is not 1 then error "target process is stale or ambiguous"\n'
    + 'set targetProcess to item 1 of matchingProcesses\n'
    + `if (name of targetProcess) is not "${app}" then error "target process identity changed"\n`
    + bundleCheck
    + 'tell targetProcess\n'
    + 'set matchingWindows to {}\n'
    + 'repeat with candidateWindow in windows\n'
    + 'try\n'
    + 'set candidateTitle to name of candidateWindow\n'
    + 'set candidatePosition to position of candidateWindow\n'
    + 'set candidateSize to size of candidateWindow\n'
    + `if candidateTitle is "${title}" and my nearValue(item 1 of candidatePosition, ${String(x)}) and my nearValue(item 2 of candidatePosition, ${String(y)}) and my nearValue(item 1 of candidateSize, ${String(width)}) and my nearValue(item 2 of candidateSize, ${String(height)}) then set end of matchingWindows to candidateWindow\n`
    + 'end try\n'
    + 'end repeat\n'
    + 'if (count matchingWindows) is not 1 then error "target window is stale or ambiguous"\n'
    + 'set frontmost to true\n'
    + 'perform action "AXRaise" of item 1 of matchingWindows\n'
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
  const pid = JSON.stringify(window.pid)
  const title = JSON.stringify(window.title)
  const bundle = JSON.stringify(window.bundleId ?? null)
  const expected = JSON.stringify(window.bounds)
  return String.raw`const systemEvents = Application('System Events');
const appName = ${app};
const expectedPid = ${pid};
const expectedTitle = ${title};
const expectedBundle = ${bundle};
const expectedBounds = ${expected};
function read(fn, fallback) { try { const value = fn(); return value === undefined ? fallback : value; } catch (_) { return fallback; } }
function pair(value) { return Array.isArray(value) && value.length >= 2 ? [Number(value[0]), Number(value[1])] : null; }
const processes = systemEvents.applicationProcesses();
const matchingProcesses = [];
for (let index = 0; index < processes.length; index += 1) {
  if (Number(read(() => processes[index].unixId(), -1)) === expectedPid
      && String(read(() => processes[index].name(), '')) === appName
      && (expectedBundle === null
        || String(read(() => processes[index].bundleIdentifier(), '')) === expectedBundle)) {
    matchingProcesses.push(processes[index]);
  }
}
if (matchingProcesses.length !== 1) throw new Error('application process is stale or ambiguous: ' + appName);
const process = matchingProcesses[0];
const windows = process.windows();
function sameWindow(candidate) {
  const name = String(read(() => candidate.name(), ''));
  const position = pair(read(() => candidate.position(), null));
  const size = pair(read(() => candidate.size(), null));
  return name === expectedTitle && position !== null && size !== null
    && Math.abs(position[0] - expectedBounds.x) <= 2
    && Math.abs(position[1] - expectedBounds.y) <= 2
    && Math.abs(size[0] - expectedBounds.width) <= 2
    && Math.abs(size[1] - expectedBounds.height) <= 2;
}
const matchingWindows = [];
for (let index = 0; index < windows.length; index += 1) {
  if (sameWindow(windows[index])) matchingWindows.push(windows[index]);
}
if (matchingWindows.length !== 1) throw new Error('window is stale or ambiguous: ' + expectedTitle);
const target = matchingWindows[0];
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
