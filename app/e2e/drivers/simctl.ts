/** Shared simulator interaction primitives. Resource ownership lives in
 * simulator-session.ts; this module deliberately exposes no device discovery,
 * erase, delete, detached-helper, or shared-Metro lifecycle helper. */
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { AxSnapshot } from './ax';

export const APP_DIR = resolve(dirname(Bun.fileURLToPath(import.meta.url)), '..', '..');
export const BUNDLE_ID = 'com.sovranbitcoin.dev';
export const DEFAULT_DEVICE = 'iPhone 17 Pro';

/** Resolved only at the simulator effect boundary. Offline commands import this
 * module too and must not require optional native tooling just to validate or
 * smoke-test JSON orchestration. */
export function resolveServeSimBin(
  appDir = APP_DIR,
  pathExists: (path: string) => boolean = existsSync
): string {
  const bin = [
    join(appDir, 'node_modules', '.bin', 'serve-sim'),
    join(appDir, '..', 'node_modules', '.bin', 'serve-sim'),
  ].find(pathExists);
  if (!bin) throw new Error('serve-sim not found in node_modules/.bin — run bun install');
  return bin;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export function log(msg: string) {
  process.stderr.write(`[sim] ${msg}\n`);
}

/** Host-tool output is private before Bun receives either file handle. */
export function preparePrivateLog(path: string): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const fd = openSync(path, 'w', 0o600);
  closeSync(fd);
  chmodSync(path, 0o600);
}

export interface RunOptions {
  allowFail?: boolean;
  signal?: AbortSignal;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('operation aborted');
}

export async function run(cmd: string[], opts: RunOptions = {}): Promise<string> {
  if (opts.signal?.aborted) throw abortReason(opts.signal);
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
  const onAbort = () => proc.kill('SIGTERM');
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (opts.signal?.aborted) throw abortReason(opts.signal);
    if (code !== 0 && !opts.allowFail)
      throw new Error(`command failed (${code}): ${cmd.join(' ')}\n${err || out}`);
    return out.trim();
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

interface TouchSocket {
  binaryType: string;
  readyState: number;
  onopen: null | (() => void);
  onerror: null | (() => void);
  onclose: null | (() => void);
  send(data: Uint8Array): void;
  close(): void;
}

interface PressAtDependencies {
  createSocket?: (endpoint: string) => TouchSocket;
  wait?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

const TOUCH_PACKET = 3;
const KEY_PACKET = 4;
const TOUCH_DOWN_MS = 120;
const TOUCH_FLUSH_MS = 50;
const KEY_DOWN_MS = 25;
// Inter-character gap. Long strings typed into fields that run heavy work on
// every keystroke (e.g. live URI parsing in the signer paste sheet) drop
// characters when keys arrive faster than the field drains them; 55ms mostly
// cleared the overrun, but a ~130-char nostrconnect URI still lost a plain
// mid-run keystroke on a live run (2026-07-17) — 85ms buys headroom for the
// heaviest fields at ~4s extra on the longest strings we type.
const KEY_GAP_MS = 85;

function touchPacket(type: 'begin' | 'move' | 'end', x: number, y: number): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify({ type, x, y }));
  const packet = new Uint8Array(body.length + 1);
  packet[0] = TOUCH_PACKET;
  packet.set(body, 1);
  return packet;
}

function keyPacket(type: 'down' | 'up', usage: number): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify({ type, usage }));
  const packet = new Uint8Array(body.length + 1);
  packet[0] = KEY_PACKET;
  packet.set(body, 1);
  return packet;
}

/**
 * Type a sequence of HID keystrokes over ONE bridge socket (per-key sockets
 * would add ~100 handshakes to a URL). Each stroke is a full press with the
 * shift modifier held around it when needed.
 */
export async function typeKeystrokes(
  touchEndpoint: string,
  strokes: readonly { usage: number; shift: boolean }[],
  shiftUsage: number,
  dependencies: PressAtDependencies = {}
): Promise<void> {
  const createSocket =
    dependencies.createSocket ??
    ((endpoint: string) => new WebSocket(endpoint) as unknown as TouchSocket);
  const wait = dependencies.wait ?? sleep;
  const socket = createSocket(touchEndpoint);
  try {
    await waitForTouchSocket(socket, dependencies.signal);
    // Hold shift across a run of consecutive shifted keys instead of toggling
    // it per character. Per-char toggling thrashed the modifier and
    // intermittently dropped the key ADJACENT to a shift transition on long
    // mixed-case strings (e.g. a nostrconnect:// URI losing a char next to the
    // shifted ':'). Shift now goes down once when the run starts and up once
    // when it ends.
    let shiftHeld = false;
    for (const stroke of strokes) {
      if (stroke.shift && !shiftHeld) {
        socket.send(keyPacket('down', shiftUsage));
        await waitWithAbort(wait, KEY_DOWN_MS, dependencies.signal);
        shiftHeld = true;
      } else if (!stroke.shift && shiftHeld) {
        socket.send(keyPacket('up', shiftUsage));
        await waitWithAbort(wait, KEY_DOWN_MS, dependencies.signal);
        shiftHeld = false;
      }
      socket.send(keyPacket('down', stroke.usage));
      await waitWithAbort(wait, KEY_DOWN_MS, dependencies.signal);
      socket.send(keyPacket('up', stroke.usage));
      await waitWithAbort(wait, KEY_DOWN_MS, dependencies.signal);
      await waitWithAbort(wait, KEY_GAP_MS, dependencies.signal);
    }
    if (shiftHeld) {
      socket.send(keyPacket('up', shiftUsage));
      await waitWithAbort(wait, KEY_DOWN_MS, dependencies.signal);
    }
    await waitWithAbort(wait, TOUCH_FLUSH_MS, dependencies.signal);
  } finally {
    socket.close();
  }
}

export async function gesture(
  touchEndpoint: string,
  type: 'begin' | 'move' | 'end',
  x: number,
  y: number,
  dependencies: PressAtDependencies = {}
): Promise<void> {
  if (
    ![x, y].every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1)
  ) {
    throw new Error('simulator gesture coordinates must be finite values between 0 and 1');
  }
  const createSocket =
    dependencies.createSocket ??
    ((endpoint: string) => new WebSocket(endpoint) as unknown as TouchSocket);
  const socket = createSocket(touchEndpoint);
  try {
    await waitForTouchSocket(socket, dependencies.signal);
    socket.send(touchPacket(type, x, y));
    await waitWithAbort(dependencies.wait ?? sleep, 25, dependencies.signal);
  } finally {
    socket.close();
  }
}

async function waitForTouchSocket(socket: TouchSocket, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortReason(signal);
  socket.binaryType = 'arraybuffer';
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      socket.onopen = null;
      socket.onerror = null;
      socket.onclose = null;
    };
    const finish = (error?: Error, close = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (close) socket.close();
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(
      () => finish(new Error('serve-sim touch connection timed out'), true),
      5000
    );
    const onAbort = () => finish(abortReason(signal!), true);
    socket.onopen = () => finish();
    socket.onerror = () => finish(new Error('serve-sim touch connection failed'), true);
    socket.onclose = () => finish(new Error('serve-sim touch connection closed before opening'));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitWithAbort(
  wait: (ms: number) => Promise<void>,
  ms: number,
  signal?: AbortSignal
): Promise<void> {
  if (!signal) return wait(ms);
  if (signal.aborted) throw abortReason(signal);
  let onAbort: (() => void) | undefined;
  try {
    await Promise.race([
      wait(ms),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(abortReason(signal));
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/** One bounded press on the already-owned serve-sim WebSocket. Keeping down
 * and up on the same connection avoids split HID sessions and avoids spawning
 * an unmanaged detached helper during retries. */
export async function pressAt(
  touchEndpoint: string,
  x: number,
  y: number,
  dependencies: PressAtDependencies = {}
) {
  if (
    ![x, y].every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1)
  ) {
    throw new Error('serve-sim touch coordinates must be finite values between 0 and 1');
  }
  const createSocket =
    dependencies.createSocket ??
    ((endpoint: string) => new WebSocket(endpoint) as unknown as TouchSocket);
  const wait = dependencies.wait ?? sleep;
  const signal = dependencies.signal;
  let socket: TouchSocket | undefined;

  // Retry only before any touch can have reached the simulator.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (signal?.aborted) throw abortReason(signal);
      socket = createSocket(touchEndpoint);
      await waitForTouchSocket(socket, signal);
      break;
    } catch (e) {
      socket?.close();
      socket = undefined;
      if (signal?.aborted || attempt === 3) throw e;
      await waitWithAbort(wait, 250, signal);
    }
  }
  if (!socket) throw new Error('serve-sim touch connection unavailable');

  let touchDownMayHaveBeenSent = false;
  try {
    socket.send(touchPacket('begin', x, y));
    touchDownMayHaveBeenSent = true;
    await waitWithAbort(wait, TOUCH_DOWN_MS, signal);
    if (socket.readyState !== 1) throw new Error('serve-sim touch connection closed mid-press');
    socket.send(touchPacket('end', x, y));
    touchDownMayHaveBeenSent = false;
    await waitWithAbort(wait, TOUCH_FLUSH_MS, signal);
    socket.close();
  } catch (error) {
    if (touchDownMayHaveBeenSent && socket.readyState === 1) {
      try {
        socket.send(touchPacket('end', x, y));
      } catch {
        // The same owned socket is already failing; never start another press.
      }
    }
    socket.close();
    throw error;
  }
}

async function hasBakedEntitlements(app: string): Promise<boolean> {
  return (await run(['otool', '-l', join(app, 'Sovran')], { allowFail: true })).includes(
    '__entitlements'
  );
}
export async function findInstallableApp(
  targetUdid?: string,
  bundleId = BUNDLE_ID,
  onLifecycle: (message: string) => void = log
): Promise<string> {
  const candidates: { path: string; mtime: number }[] = [];
  const push = (app: string) => {
    if (existsSync(join(app, 'Sovran')))
      candidates.push({ path: app, mtime: statSync(app).mtimeMs });
  };
  const derived = join(homedir(), 'Library', 'Developer', 'Xcode', 'DerivedData');
  for (const entry of existsSync(derived) ? readdirSync(derived) : []) {
    if (!entry.startsWith('Sovran-')) continue;
    const products = join(derived, entry, 'Build', 'Products');
    for (const config of existsSync(products) ? readdirSync(products) : []) {
      if (config.endsWith('-iphonesimulator')) push(join(products, config, 'Sovran.app'));
    }
  }
  const devices = join(homedir(), 'Library', 'Developer', 'CoreSimulator', 'Devices');
  for (const dev of existsSync(devices) ? readdirSync(devices) : []) {
    if (dev === targetUdid) continue;
    const apps = join(devices, dev, 'data', 'Containers', 'Bundle', 'Application');
    for (const container of existsSync(apps) ? readdirSync(apps) : [])
      push(join(apps, container, 'Sovran.app'));
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  for (const c of candidates) {
    const id = (
      await run(['plutil', '-extract', 'CFBundleIdentifier', 'raw', join(c.path, 'Info.plist')], {
        allowFail: true,
      })
    ).trim();
    if (id !== bundleId) continue;
    if (!(await hasBakedEntitlements(c.path))) {
      onLifecycle(`skipping ${c.path} — no __entitlements (SecureStore would fail)`);
      continue;
    }
    return c.path;
  }
  throw new Error(
    `no installable ${bundleId} Sovran.app with baked entitlements — build with: cd app && bun ios`
  );
}

interface DevClientChromeDependencies {
  press?: typeof pressAt;
  gesture?: typeof gesture;
}

/** Dismiss dev-client / springboard chrome; returns true if it pressed something. */
export async function handleDevClientChrome(
  _udid: string,
  touchEndpoint: string,
  snap: AxSnapshot,
  signal?: AbortSignal,
  dependencies: DevClientChromeDependencies = {}
): Promise<boolean> {
  const press = dependencies.press ?? pressAt;
  const touchGesture = dependencies.gesture ?? gesture;
  const has = (p: string) => snap.elements.some((e) => e.label?.startsWith(p));
  const includes = (n: string) => snap.elements.some((e) => e.label?.includes(n));
  const pressExact = async (label: string) => {
    const el = snap.elements.find((e) => e.label === label && e.role === 'button');
    if (!el) return false;
    await press(
      touchEndpoint,
      (el.frame.x + el.frame.width / 2) / snap.screen.width,
      (el.frame.y + el.frame.height / 2) / snap.screen.height,
      { signal }
    );
    return true;
  };
  // A failed Apple Intelligence banner dismissal can foreground Settings. Its
  // page still contains the broad Apple Intelligence text below, so return to
  // the owned app before considering another dismissal gesture.
  if (await pressExact('Return to Sovran')) return true;
  if (includes('Apple Intelligence') || includes('Time to experience')) {
    await touchGesture(touchEndpoint, 'begin', 0.5, 0.11, { signal });
    await touchGesture(touchEndpoint, 'move', 0.5, 0.04, { signal });
    await touchGesture(touchEndpoint, 'end', 0.5, 0.02, { signal });
    return true;
  }
  if (has('Open in')) return pressExact('Open');
  // Case-insensitive: iOS 26.2 sentence-cases permission alerts
  // ("“Sovran” would like to access the Camera") where earlier runtimes used
  // title case — a case-sensitive miss leaves the alert occluding the app.
  const hasFold = (p: string) =>
    snap.elements.some((e) => e.label?.toLowerCase().startsWith(p.toLowerCase()));
  if (hasFold('Allow “Sovran”') || hasFold('“Sovran” Would Like'))
    return (
      (await pressExact('Allow While Using App')) || (await pressExact('Allow')) || pressExact('OK')
    );
  if (includes('would like to paste')) return pressExact('Allow Paste');
  if (has('This is the developer menu')) return pressExact('Continue');
  if (has('Fast refresh') || has('Toggle element inspector')) {
    await press(touchEndpoint, 0.5, 0.15, { signal });
    return true;
  }
  return false;
}
