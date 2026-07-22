/**
 * The real device driver: implements `Driver` against a booted iOS simulator,
 * built on the shared interaction layer (simctl.ts) + the pure AX logic
 * (ax.ts). Resource creation and deletion remain sealed in simulator-session;
 * this driver receives only a session-bound install function.
 */
import { chmodSync, closeSync, constants, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { redactString } from '../core/redact';
import {
  parseE2EReadyProofAssets,
  type E2EReadyProofAsset,
} from '../../shared/lib/cashu/e2eProofReconciliationConfig';
import {
  E2E_READY_PROOF_STATUS_ID,
  parseE2EReadyProofStatus,
} from '../../shared/lib/cashu/e2eReadyProofStatus';
import type { Driver, AxNode, ScreenshotOptions, StateObservation } from './driver';
import type { Selector } from '../schema/selectors';
import {
  classifyObservedState,
  elementTapCenter,
  parseSseData,
  findElement,
  toAxNode,
  parseBalanceSat,
  type AxElement,
  type AxSnapshot,
} from './ax';
import {
  BUNDLE_ID,
  run,
  pressAt,
  gesture,
  handleDevClientChrome,
  sleep,
  typeKeystrokes,
} from './simctl';
import { BACKSPACE_USAGE, hidKeystrokesFor, LEFT_SHIFT_USAGE } from './hid-keys';
import { SimulatorInfrastructureError } from './simulator-session';
import { isProfileSecretAxId } from './ax-redaction';

export interface SimConfig {
  udid: string;
  axEndpoint: string;
  touchEndpoint: string;
  pollMs?: number;
  signal?: AbortSignal;
}

export interface SimulatorDriverDeps {
  axWatcher?: AxWatcher;
  install?: (reset: 'erase' | 'reinstall' | 'none') => Promise<void>;
  press?: (x: number, y: number) => Promise<void>;
  captureAxSnapshot?: () => Promise<AxSnapshot>;
  captureRawScreenshot?: (path: string) => Promise<void>;
  screenshotSettleMs?: number;
  screenshotTempRoot?: string;
  refreshClearMs?: number;
  reportInfrastructureFailure?: (error: SimulatorInfrastructureError) => void;
}

// The Expo dev-client shows a native "Refreshing…" DevLoadingView overlay after
// the openurl deep-link reload (fired on every launch/home). It is NOT in the RN
// accessibility tree, so it can't be waited-out by selector — only by time. After
// a reload's content appears we let it animate away (REFRESH_CLEAR_MS), and every
// screenshot settles briefly (SHOT_SETTLE_MS) for the banner tail + content-shift.
const REFRESH_CLEAR_MS = 1800;
const SHOT_SETTLE_MS = 450;
const WALLET_TAB_SELECTOR = { id: 'tab-wallet' } as const;
const WALLET_READY_SELECTOR = { id: 'wallet-send' } as const;

export interface PrivateScreenshotTarget {
  directory: string;
  path: string;
  cleanup(): void;
}

/** Allocate the only on-disk raw-frame seam. Both directory traversal and the
 * file itself are owner-only before simctl receives the path. A unique private
 * directory also prevents predictable-name replacement and symlink attacks. */
export function createPrivateScreenshotTarget(parent = tmpdir()): PrivateScreenshotTarget {
  const directory = mkdtempSync(join(parent, 'sovran-e2e-shot-'));
  chmodSync(directory, 0o700);
  const path = join(directory, 'raw.png');
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  closeSync(fd);
  chmodSync(path, 0o600);
  return {
    directory,
    path,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

interface RawCaptureAxNode {
  AXUniqueId: string | null;
  AXLabel: string | null;
  AXValue: string | null;
  enabled: boolean;
  frame: MaskFrame;
  role_description: string;
  type: string;
  children: RawCaptureAxNode[];
}

function validFrame(frame: unknown): frame is MaskFrame {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return false;
  const candidate = frame as Partial<MaskFrame>;
  return [candidate.x, candidate.y, candidate.width, candidate.height].every(Number.isFinite);
}

function validRawAxNode(value: unknown): value is RawCaptureAxNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<RawCaptureAxNode>;
  return (
    validFrame(candidate.frame) &&
    Array.isArray(candidate.children) &&
    candidate.children.every(validRawAxNode)
  );
}

/** Normalize serve-sim's owner-loopback one-shot axe tree using the same shape
 * as its SSE stream. The one-shot request is deliberate: the stream suppresses
 * unchanged frames, so it cannot authoritatively bracket a bitmap capture. */
function parseCaptureAxSnapshot(value: unknown): AxSnapshot {
  if (!Array.isArray(value) || !value.length || !value.every(validRawAxNode)) {
    throw new Error('simulator returned an invalid accessibility snapshot');
  }
  const roots = value;
  const screenFrame = roots[0].frame;
  if (screenFrame.width <= 1 || screenFrame.height <= 1) {
    throw new Error('simulator returned an invalid accessibility snapshot');
  }
  const elements: AxElement[] = [];
  const sameFrame = (left: MaskFrame, right: MaskFrame) =>
    Math.abs(left.x - right.x) < 0.5 &&
    Math.abs(left.y - right.y) < 0.5 &&
    Math.abs(left.width - right.width) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5;
  const visit = (node: RawCaptureAxNode, path: string) => {
    if (elements.length >= 500) return;
    if (!sameFrame(node.frame, screenFrame)) {
      elements.push({
        id: node.AXUniqueId ?? path,
        label: node.AXLabel ?? '',
        value: node.AXValue ?? '',
        role: node.role_description,
        enabled: node.enabled !== false,
        frame: node.frame,
      });
    }
    for (let index = 0; index < node.children.length && elements.length < 500; index++) {
      visit(node.children[index]!, `${path}.${index}`);
    }
  };
  roots.forEach((root, index) => visit(root, String(index)));
  return { screen: { width: screenFrame.width, height: screenFrame.height }, elements };
}

async function captureSimulatorAxSnapshot(cfg: SimConfig): Promise<AxSnapshot> {
  let endpoint: URL;
  try {
    endpoint = new URL(cfg.axEndpoint);
    endpoint.pathname = `/helper/${encodeURIComponent(cfg.udid)}/ax`;
    endpoint.search = '';
    endpoint.hash = '';
  } catch {
    throw new Error('simulator AX endpoint is invalid');
  }
  // eslint-disable-next-line no-restricted-globals -- owned loopback serve-sim snapshot endpoint
  const response = await fetch(endpoint, { signal: cfg.signal });
  if (!response.ok) {
    throw new Error(`simulator accessibility snapshot failed with status ${response.status}`);
  }
  return parseCaptureAxSnapshot(await response.json());
}

export function assertSuccessfulExit(operation: string, code: number): void {
  if (code !== 0) throw new Error(`${operation} failed with exit code ${code}`);
}

export function fundedSweepProbeComplete(
  rawStatus: string,
  expectedInput: readonly E2EReadyProofAsset[]
): boolean {
  const status = parseE2EReadyProofStatus(rawStatus);
  if (status.phase === 'idle' || status.phase === 'running') return false;
  if (status.phase === 'failed') throw new Error('app ready-proof reconciliation failed');
  const expected = parseE2EReadyProofAssets(JSON.stringify({ version: 1, assets: expectedInput }));
  if (status.assets !== expected.length || status.remaining.length !== expected.length) {
    throw new Error('app ready-proof reconciliation returned an unexpected asset set');
  }
  const remaining = new Map(
    status.remaining.map((asset) => [`${asset.mintUrl}\u0000${asset.unit}`, asset.amount])
  );
  for (const asset of expected) {
    const amount = remaining.get(`${asset.mintUrl}\u0000${asset.unit}`);
    if (amount === undefined) {
      throw new Error('app ready-proof reconciliation omitted a funded asset');
    }
    if (amount !== 0) return false;
  }
  return true;
}

const TRANSACTION_PROBE_FIELDS = new Set([
  'direction',
  'amount',
  'unit',
  'mintHost',
  'status',
  'source',
]);
const TRANSACTION_PROBE_SOURCES = new Set([
  'qr',
  'nfc',
  'paste',
  'deeplink',
  'ble',
  'copy',
  'share',
  'airdrop',
  'displayed',
  'npc',
]);

/** Parse the app's deliberately non-secret transaction evidence contract.
 * Unknown fields fail closed so a later UI change cannot smuggle a payment
 * payload, destination, proof, or identity into AX artifacts. */
export function parseTransactionProbe(raw: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('invalid transaction probe JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('transaction probe must be an object');
  }
  for (const key of Object.keys(value)) {
    if (!TRANSACTION_PROBE_FIELDS.has(key)) {
      throw new Error(`unexpected field in transaction probe: ${key}`);
    }
  }
  const probe = value as Record<string, unknown>;
  if (probe.direction !== 'in' && probe.direction !== 'out') {
    throw new Error('transaction probe direction must be in or out');
  }
  if (!Number.isSafeInteger(probe.amount) || (probe.amount as number) <= 0) {
    throw new Error('transaction probe amount must be a positive integer');
  }
  for (const key of ['unit', 'mintHost', 'status'] as const) {
    if (typeof probe[key] !== 'string' || !probe[key]) {
      throw new Error(`transaction probe ${key} must be a non-empty string`);
    }
  }
  if (probe.source !== null && !TRANSACTION_PROBE_SOURCES.has(probe.source as string)) {
    throw new Error('transaction probe source must be null or an allowed source');
  }
  return probe;
}

type MaskFrame = { x: number; y: number; width: number; height: number };

function sameMaskFrame(left: MaskFrame, right: MaskFrame): boolean {
  return (
    Math.abs(left.x - right.x) < 0.5 &&
    Math.abs(left.y - right.y) < 0.5 &&
    Math.abs(left.width - right.width) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5
  );
}

function sameMaskFrameSet(left: readonly MaskFrame[], right: readonly MaskFrame[]): boolean {
  if (left.length !== right.length) return false;
  const unmatched = [...right];
  for (const frame of left) {
    const index = unmatched.findIndex((candidate) => sameMaskFrame(frame, candidate));
    if (index < 0) return false;
    unmatched.splice(index, 1);
  }
  return true;
}

function nativeShareSheetOpen(snapshot: AxSnapshot): boolean {
  const ids = new Set(snapshot.elements.map((element) => element.id).filter(Boolean));
  const systemCells = snapshot.elements.filter(
    (element) => element.id === 'shareCell' || element.id === 'actionGroupCell'
  );
  if (ids.has('activityCollectionView') && systemCells.length >= 2) return true;

  // Older iOS simulator runtimes exposed a Close button plus the standard
  // destination labels instead of UIKit's stable activity collection IDs.
  const labels = new Set(snapshot.elements.map((element) => element.label).filter(Boolean));
  const shareHints = ['AirDrop', 'Messages', 'Mail', 'Copy'].filter((label) => labels.has(label));
  return labels.has('Close') && shareHints.length >= 2;
}

/** Resolve app selectors plus the two virtual IDs owned by the iOS share
 * sheet. System UI cannot carry React Native testIDs, so these IDs are mapped
 * only while the unmistakable share-sheet AX signature is present. */
export function findSimulatorElement(snapshot: AxSnapshot, selector: Selector): AxElement | null {
  const direct = findElement(snapshot, selector);
  if (direct) return direct;
  if (!('id' in selector) || !nativeShareSheetOpen(snapshot)) return null;
  if (selector.id === 'native-share-sheet') {
    return {
      id: selector.id,
      label: 'Native share sheet',
      enabled: true,
      frame: { x: 0, y: 0, width: snapshot.screen.width, height: snapshot.screen.height },
    };
  }
  if (selector.id === 'native-share-dismiss') {
    const close = snapshot.elements.find((element) => element.label === 'Close');
    if (close) return { ...close, id: selector.id };

    // Current iPhone share sheets have no Close AX node. A tap in the clear
    // top strip dismisses the page sheet without choosing a share target.
    return {
      id: selector.id,
      label: 'Dismiss native share sheet',
      enabled: true,
      frame: {
        x: 0,
        y: 0,
        width: snapshot.screen.width,
        height: snapshot.screen.height * 0.2,
      },
    };
  }
  return null;
}

/** Return device-coordinate regions that can expose test recovery/payment
 * material when an authored checkpoint opts into masking. The app marks
 * QR/text payment visuals explicitly; raw system AX values are detected
 * defensively. A native iOS share sheet becomes a full-frame mask. */
export function automaticSensitiveMaskFrames(snapshot: AxSnapshot): MaskFrame[] {
  if (nativeShareSheetOpen(snapshot)) {
    return [{ x: 0, y: 0, width: snapshot.screen.width, height: snapshot.screen.height }];
  }

  const frames = snapshot.elements
    .filter((element) => {
      if (element.id === 'payment-info-sensitive-visual') return true;
      if (element.id?.startsWith('payment-info-') && element.id.endsWith('-data')) return true;
      return [element.label, element.value].some(
        (value) => typeof value === 'string' && redactString(value) !== value
      );
    })
    .map((element) => element.frame);
  return frames.filter(
    (frame, index) =>
      frames.findIndex(
        (candidate) =>
          candidate.x === frame.x &&
          candidate.y === frame.y &&
          candidate.width === frame.width &&
          candidate.height === frame.height
      ) === index
  );
}

/** Secret-bearing profile fields are never allowed into screenshot artifacts,
 * even when a scenario did not author an explicit mask. Their stable IDs keep
 * this protection independent of whether native AX exposes or redacts the
 * field's current value. */
function alwaysMaskedProfileFrames(snapshot: AxSnapshot): MaskFrame[] {
  return snapshot.elements
    .filter((element) => isProfileSecretAxId(element.id))
    .map((element) => element.frame);
}

function projectMaskFrame(
  frame: MaskFrame,
  screen: AxSnapshot['screen'],
  bitmap: { width: number; height: number }
): { left: number; top: number; width: number; height: number } | null {
  if (
    ![screen.width, screen.height, frame.x, frame.y, frame.width, frame.height].every(
      Number.isFinite
    ) ||
    screen.width <= 0 ||
    screen.height <= 0 ||
    frame.width <= 0 ||
    frame.height <= 0
  ) {
    return null;
  }
  const frameRight = frame.x + frame.width;
  const frameBottom = frame.y + frame.height;
  if (!Number.isFinite(frameRight) || !Number.isFinite(frameBottom)) return null;

  const clippedLeft = Math.max(0, frame.x);
  const clippedTop = Math.max(0, frame.y);
  const clippedRight = Math.min(screen.width, frameRight);
  const clippedBottom = Math.min(screen.height, frameBottom);
  if (clippedRight <= clippedLeft || clippedBottom <= clippedTop) return null;

  const left = Math.max(
    0,
    Math.min(bitmap.width - 1, Math.floor((clippedLeft / screen.width) * bitmap.width))
  );
  const top = Math.max(
    0,
    Math.min(bitmap.height - 1, Math.floor((clippedTop / screen.height) * bitmap.height))
  );
  const right = Math.max(
    left + 1,
    Math.min(bitmap.width, Math.ceil((clippedRight / screen.width) * bitmap.width))
  );
  const bottom = Math.max(
    top + 1,
    Math.min(bitmap.height, Math.ceil((clippedBottom / screen.height) * bitmap.height))
  );
  return { left, top, width: right - left, height: bottom - top };
}

/** Preserve ordinary QA evidence by default, but always mask stable profile
 * secret fields. Once a checkpoint supplies an explicit mask id, also apply
 * the broader sensitive-region masks. */
export async function maskScreenshotBytes(
  bytes: Uint8Array,
  snapshot: AxSnapshot | null,
  explicitMaskIds: readonly string[] = [],
  snapshotAfterCapture: AxSnapshot | null = snapshot
): Promise<Uint8Array> {
  if (!bytes.length) throw new Error('simctl produced an empty screenshot');
  if (!snapshot) {
    if (explicitMaskIds.length)
      throw new Error('cannot capture screenshot without an accessibility snapshot');
    return bytes;
  }
  if (!snapshotAfterCapture) {
    throw new Error('cannot capture screenshot without a post-capture accessibility snapshot');
  }
  const alwaysBefore = alwaysMaskedProfileFrames(snapshot);
  const alwaysAfter = alwaysMaskedProfileFrames(snapshotAfterCapture);
  if (!explicitMaskIds.length && !alwaysBefore.length && !alwaysAfter.length) return bytes;
  const explicitBefore: MaskFrame[] = [];
  const explicitAfter: MaskFrame[] = [];
  let explicitMaskChanged = false;
  for (const id of explicitMaskIds) {
    const before = snapshot.elements.find((candidate) => candidate.id === id)?.frame;
    const after = snapshotAfterCapture.elements.find((candidate) => candidate.id === id)?.frame;
    if (!before && !after) throw new Error(`screenshot mask id not found: ${id}`);
    if (!before || !after || !sameMaskFrame(before, after)) explicitMaskChanged = true;
    if (before) explicitBefore.push(before);
    if (after) explicitAfter.push(after);
  }
  const automaticBefore = explicitMaskIds.length
    ? automaticSensitiveMaskFrames(snapshot)
    : alwaysBefore;
  const automaticAfter = explicitMaskIds.length
    ? automaticSensitiveMaskFrames(snapshotAfterCapture)
    : alwaysAfter;
  const screenChanged =
    Math.abs(snapshot.screen.width - snapshotAfterCapture.screen.width) >= 0.5 ||
    Math.abs(snapshot.screen.height - snapshotAfterCapture.screen.height) >= 0.5;
  const sensitiveGeometryChanged =
    screenChanged ||
    explicitMaskChanged ||
    !sameMaskFrameSet(automaticBefore, automaticAfter) ||
    !sameMaskFrameSet(explicitBefore, explicitAfter);
  // Simulator pixels and AX cannot be sampled atomically. If the bracketing AX
  // safety geometry differs, the bitmap may belong to either tree (or the
  // transition in between), so no region-level mask is trustworthy. Native AX
  // identities and unrelated labels can change between equivalent snapshots;
  // they do not affect which pixels can contain secrets and must not erase
  // otherwise useful evidence.
  // A fail-closed whole-frame mask must come from the decoded bitmap itself.
  // AX screen geometry can be zero or transient during native navigation; it
  // is evidence about layout, not an authority for the bitmap's dimensions.
  if (sensitiveGeometryChanged) return maskWholeScreenshotBytes(bytes);
  const maskFrames = [...automaticBefore, ...explicitBefore];
  if (!maskFrames.length) return bytes;
  const image = sharp(Buffer.from(bytes));
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('cannot read screenshot dimensions for masking');
  }
  const overlays = [];
  for (const frame of maskFrames) {
    const projected = projectMaskFrame(frame, snapshot.screen, {
      width: metadata.width,
      height: metadata.height,
    });
    if (!projected) return maskWholeScreenshotBytes(bytes);
    overlays.push({
      input: {
        create: {
          width: projected.width,
          height: projected.height,
          channels: 4 as const,
          background: { r: 0, g: 0, b: 0, alpha: 1 },
        },
      },
      left: projected.left,
      top: projected.top,
    });
  }
  return new Uint8Array(await image.composite(overlays).png().toBuffer());
}

/** When Android cannot produce trustworthy AX geometry, retain only a black
 * evidence frame. Unknown pixels are never safer than missing visual detail. */
export async function maskWholeScreenshotBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (!bytes.length) throw new Error('device produced an empty screenshot');
  const image = sharp(Buffer.from(bytes));
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('cannot read screenshot dimensions for masking');
  }
  return new Uint8Array(
    await image
      .composite([
        {
          input: {
            create: {
              width: metadata.width,
              height: metadata.height,
              channels: 4,
              background: { r: 0, g: 0, b: 0, alpha: 1 },
            },
          },
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer()
  );
}

export class AxWatcher {
  latest: AxSnapshot | null = null;
  generation = 0;
  #abort: AbortController | undefined;
  #loopPromise: Promise<void> | undefined;
  constructor(private endpoint: string) {}
  update(snapshot: AxSnapshot): void {
    this.generation++;
    this.latest = snapshot;
  }
  invalidate(): number {
    this.generation++;
    this.latest = null;
    return this.generation;
  }
  snapshotAfter(generation: number): AxSnapshot | null {
    return this.generation > generation ? this.latest : null;
  }
  current(): { snapshot: AxSnapshot; generation: number } | null {
    const snapshot = this.latest;
    return snapshot ? { snapshot, generation: this.generation } : null;
  }
  start(): void {
    if (this.#loopPromise) return;
    const abort = new AbortController();
    this.#abort = abort;
    this.#loopPromise = this.#loop(abort.signal).finally(() => {
      if (this.#abort === abort) {
        this.#abort = undefined;
        this.#loopPromise = undefined;
      }
    });
  }
  async pause(): Promise<boolean> {
    const abort = this.#abort;
    const loop = this.#loopPromise;
    if (!abort || !loop) return false;
    abort.abort();
    await loop;
    return true;
  }
  async stop(): Promise<void> {
    await this.pause();
  }
  async #loop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        // eslint-disable-next-line no-restricted-globals -- SSE is a streaming response, the documented raw-fetch exception
        const res = await fetch(this.endpoint, { signal });
        const reader = res.body?.getReader();
        if (!reader) throw new Error('no /ax body');
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const snap = parseSseData(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
            if (snap) this.update(snap);
          }
        }
      } catch {
        if (signal.aborted) return;
        await sleep(500);
      }
    }
  }
}

export class SimulatorDriver implements Driver {
  #cfg: SimConfig;
  #ax: AxWatcher;
  #install: (reset: 'erase' | 'reinstall' | 'none') => Promise<void>;
  #press: (x: number, y: number) => Promise<void>;
  #captureAxSnapshot: () => Promise<AxSnapshot>;
  #captureRawScreenshot: (path: string) => Promise<void>;
  #screenshotSettleMs: number;
  #screenshotTempRoot: string | undefined;
  #refreshClearMs: number;
  #reportInfrastructureFailure: ((error: SimulatorInfrastructureError) => void) | undefined;
  constructor(cfg: SimConfig, deps: SimulatorDriverDeps = {}) {
    this.#cfg = cfg;
    this.#ax = deps.axWatcher ?? new AxWatcher(cfg.axEndpoint);
    this.#install =
      deps.install ??
      (() => Promise.reject(new Error('SimulatorDriver requires a session-bound install')));
    this.#press =
      deps.press ?? ((x, y) => pressAt(cfg.touchEndpoint, x, y, { signal: this.#cfg.signal }));
    this.#captureAxSnapshot = deps.captureAxSnapshot ?? (() => captureSimulatorAxSnapshot(cfg));
    this.#captureRawScreenshot =
      deps.captureRawScreenshot ??
      (async (path) => {
        await run(['xcrun', 'simctl', 'io', cfg.udid, 'screenshot', '--type', 'png', path]);
      });
    this.#screenshotSettleMs = deps.screenshotSettleMs ?? SHOT_SETTLE_MS;
    this.#screenshotTempRoot = deps.screenshotTempRoot;
    this.#refreshClearMs = deps.refreshClearMs ?? REFRESH_CLEAR_MS;
    this.#reportInfrastructureFailure = deps.reportInfrastructureFailure;
  }
  start(): void {
    this.#ax.start();
  }
  async dispose(): Promise<void> {
    await this.#ax.stop();
  }
  get udid(): string {
    return this.#cfg.udid;
  }

  #center(sel: Selector): { x: number; y: number } | null {
    const snap = this.#ax.latest;
    if (!snap) return null;
    const el = findSimulatorElement(snap, sel);
    if (!el) return null;
    return elementTapCenter(el, snap.screen);
  }
  #throwIfAborted(): void {
    if (this.#cfg.signal?.aborted) throw this.#cfg.signal.reason;
  }
  // Poll for the element before tapping — resilient to /ax SSE lag (the tree can
  // briefly not contain a control that was just present in a wait).
  async #waitCenter(sel: Selector, timeoutMs = 4000): Promise<{ x: number; y: number } | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.#throwIfAborted();
      const c = this.#center(sel);
      if (c) return c;
      await sleep(this.#cfg.pollMs ?? 200);
    }
    return null;
  }

  async #waitForSnapshotAfter(generation: number, timeoutMs = 45000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.#throwIfAborted();
      if (this.#ax.snapshotAfter(generation)) return;
      await sleep(this.#cfg.pollMs ?? 200);
    }
    throw new Error(`timed out after ${timeoutMs}ms waiting for fresh accessibility snapshot`);
  }

  async #navigate(reset: 'erase' | 'reinstall' | 'none'): Promise<void> {
    this.#throwIfAborted();
    this.#ax.invalidate();
    await this.#install(reset);
    const generation = this.#ax.invalidate();
    await this.#waitForSnapshotAfter(generation);
  }

  /** Native tabs keep inactive screens in the AX tree, so labels such as
   * Split/No History cannot prove the Wallet tab is active. Press its stable
   * tab identity, reject the pre-press tree, then prove live wallet chrome. */
  async #selectWalletTab(): Promise<void> {
    await this.waitFor(WALLET_TAB_SELECTOR, 'enabled', 45_000);
    const center = await this.#waitCenter(WALLET_TAB_SELECTOR);
    if (!center) throw new Error('Wallet tab disappeared before it could be selected');
    const generation = this.#ax.invalidate();
    await this.#press(center.x, center.y);
    await this.#waitForSnapshotAfter(generation);
    await this.waitFor(WALLET_READY_SELECTOR, undefined, 45_000);
  }

  async launch(reset: 'erase' | 'reinstall' | 'none'): Promise<void> {
    await this.#navigate(reset);
  }
  /** OS-level deep link into the running app. */
  async openUrl(url: string): Promise<void> {
    this.#throwIfAborted();
    await run(['xcrun', 'simctl', 'openurl', this.#cfg.udid, url], {
      signal: this.#cfg.signal,
    });
  }
  /** simctl TCC control. iOS may SIGKILL a running app whose record changes,
   * and permission hooks cache state at mount — scenarios follow this with
   * `launch reset:none` before exercising the gated flow. */
  async setPermission(
    service: 'camera' | 'photos' | 'location',
    mode: 'grant' | 'revoke' | 'reset'
  ): Promise<void> {
    this.#throwIfAborted();
    await run(['xcrun', 'simctl', 'privacy', this.#cfg.udid, mode, service, BUNDLE_ID], {
      signal: this.#cfg.signal,
    });
  }
  async setLocation(mode: 'set' | 'clear', latitude?: number, longitude?: number): Promise<void> {
    this.#throwIfAborted();
    const args =
      mode === 'set'
        ? ['xcrun', 'simctl', 'location', this.#cfg.udid, 'set', `${latitude},${longitude}`]
        : ['xcrun', 'simctl', 'location', this.#cfg.udid, 'clear'];
    await run(args, { signal: this.#cfg.signal });
  }
  async home(): Promise<void> {
    await this.#navigate('none');
    await this.#selectWalletTab();
    await sleep(this.#refreshClearMs); // let the post-reload "Refreshing…" overlay clear before any capture
  }

  async homeAfterFundedSweep(expectedAssets: readonly E2EReadyProofAsset[]): Promise<void> {
    await this.#navigate('none');
    await this.#selectWalletTab();
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      this.#throwIfAborted();
      const node = await this.find({ id: E2E_READY_PROOF_STATUS_ID });
      if (node?.value && fundedSweepProbeComplete(node.value, expectedAssets)) {
        await this.waitFor(WALLET_READY_SELECTOR, undefined, 45_000);
        await sleep(this.#refreshClearMs);
        return;
      }
      await sleep(this.#cfg.pollMs ?? 250);
    }
    throw new Error('app did not reconcile externally swept ready proofs before timeout');
  }

  async waitFor(
    sel: Selector,
    state: 'visible' | 'enabled' | undefined,
    timeoutMs: number,
    value?: string
  ): Promise<AxNode> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.#throwIfAborted();
      const current = this.#ax.current();
      if (current) {
        const { snapshot: snap, generation } = current;
        if (
          await handleDevClientChrome(
            this.#cfg.udid,
            this.#cfg.touchEndpoint,
            snap,
            this.#cfg.signal
          )
        ) {
          // The press mutated the screen, so the cached snapshot is stale.
          // Wait for a FRESH snapshot before considering another press — a
          // stale-coordinate re-press ghost-taps whatever now sits under the
          // dismissed alert's button (observed: Scan-QR under "Allow While
          // Using App" on iOS 26.2).
          const pressDeadline = Math.min(deadline, Date.now() + 10_000);
          while (Date.now() < pressDeadline && !this.#ax.snapshotAfter(generation)) {
            this.#throwIfAborted();
            await sleep(this.#cfg.pollMs ?? 250);
          }
          continue;
        }
        const el = findSimulatorElement(snap, sel);
        if (el && (state !== 'enabled' || el.enabled !== false)) {
          const node = toAxNode(el);
          if (value === undefined || node.value === value) return node;
        }
      }
      await sleep(this.#cfg.pollMs ?? 250);
    }
    throw new Error(
      `timed out after ${timeoutMs}ms waiting for ${JSON.stringify(sel)}${
        value === undefined ? '' : ` with value "${value}"`
      }`
    );
  }

  async find(sel: Selector): Promise<AxNode | null> {
    const snap = this.#ax.latest;
    if (!snap) return null;
    const el = findSimulatorElement(snap, sel);
    return el ? toAxNode(el) : null;
  }

  async tap(sel: Selector): Promise<void> {
    const c = await this.#waitCenter(sel);
    if (!c) throw new Error(`tap: selector not on screen ${JSON.stringify(sel)}`);
    await this.#press(c.x, c.y);
  }
  async tapAt(x: number, y: number): Promise<void> {
    await this.#press(x, y);
  }
  async swipe(dir: 'left' | 'right' | 'up' | 'down'): Promise<void> {
    const [a, b] =
      dir === 'left'
        ? [
            [0.85, 0.5],
            [0.15, 0.5],
          ]
        : dir === 'right'
          ? [
              [0.15, 0.5],
              [0.85, 0.5],
            ]
          : dir === 'up'
            ? [
                [0.5, 0.7],
                [0.5, 0.3],
              ]
            : [
                [0.5, 0.3],
                [0.5, 0.7],
              ];
    await gesture(this.#cfg.touchEndpoint, 'begin', a[0], a[1], { signal: this.#cfg.signal });
    for (let i = 1; i <= 8; i++) {
      await sleep(25);
      await gesture(
        this.#cfg.touchEndpoint,
        'move',
        a[0] + ((b[0] - a[0]) * i) / 8,
        a[1] + ((b[1] - a[1]) * i) / 8,
        { signal: this.#cfg.signal }
      );
    }
    await gesture(this.#cfg.touchEndpoint, 'end', b[0], b[1], { signal: this.#cfg.signal });
  }
  async drag(
    sel: Selector,
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs = 400
  ): Promise<void> {
    const deadline = Date.now() + 4_000;
    let element: AxElement | null = null;
    let snapshot: AxSnapshot | null = null;
    while (Date.now() < deadline) {
      this.#throwIfAborted();
      snapshot = this.#ax.latest;
      element = snapshot ? findSimulatorElement(snapshot, sel) : null;
      if (snapshot && element) break;
      await sleep(this.#cfg.pollMs ?? 200);
    }
    if (!snapshot || !element) {
      throw new Error(`drag: selector not on screen ${JSON.stringify(sel)}`);
    }
    const point = ({ x, y }: { x: number; y: number }) => ({
      x: (element!.frame.x + element!.frame.width * x) / snapshot!.screen.width,
      y: (element!.frame.y + element!.frame.height * y) / snapshot!.screen.height,
    });
    const start = point(from);
    const end = point(to);
    const moves = Math.max(4, Math.min(40, Math.ceil(durationMs / 25)));
    await gesture(this.#cfg.touchEndpoint, 'begin', start.x, start.y, {
      signal: this.#cfg.signal,
    });
    for (let index = 1; index <= moves; index++) {
      await sleep(Math.max(10, Math.floor(durationMs / moves)));
      await gesture(
        this.#cfg.touchEndpoint,
        'move',
        start.x + ((end.x - start.x) * index) / moves,
        start.y + ((end.y - start.y) * index) / moves,
        { signal: this.#cfg.signal }
      );
    }
    await gesture(this.#cfg.touchEndpoint, 'end', end.x, end.y, {
      signal: this.#cfg.signal,
    });
  }
  async input(sel: Selector, value: string): Promise<void> {
    // Map the whole string BEFORE focusing so an unmappable character fails
    // without leaving a half-typed field behind.
    const strokes = hidKeystrokesFor(value);
    // Focus must be PROVEN before any letter is typed: a tap on a TextInput
    // can be silently swallowed (observed on SendScreen's ScrollView), and
    // unfocused HID letters hit expo-dev-menu's global key commands — a stray
    // 'r' reloads the dev-client app mid-scenario. Digits carry no dev-menu
    // binding, so type a benign '1' probe and require the field's AX value to
    // echo it before committing the real text.
    const probe = hidKeystrokesFor('1');
    let focused = false;
    for (let attempt = 0; attempt < 4 && !focused; attempt++) {
      await this.tap(sel); // focus the field
      await sleep(800); // keyboard attach / autofocus settle
      await typeKeystrokes(this.#cfg.touchEndpoint, probe, LEFT_SHIFT_USAGE, {
        signal: this.#cfg.signal,
      });
      try {
        await this.waitFor(sel, undefined, 2_000, '1');
        focused = true;
      } catch {
        // The probe never echoed into the field's AX value — the focus tap
        // missed. The digit was a global no-op, so re-tapping is safe.
      }
    }
    if (!focused) {
      throw new Error(`input: field never took keyboard focus ${JSON.stringify(sel)}`);
    }
    await typeKeystrokes(
      this.#cfg.touchEndpoint,
      [{ usage: BACKSPACE_USAGE, shift: false }],
      LEFT_SHIFT_USAGE,
      { signal: this.#cfg.signal }
    );
    await typeKeystrokes(this.#cfg.touchEndpoint, strokes, LEFT_SHIFT_USAGE, {
      signal: this.#cfg.signal,
    });
    await sleep(400); // let debounced onChangeText handlers observe the text
  }
  async typeText(value: string, focus?: { x: number; y: number }): Promise<void> {
    // Same contract as input(), but for fields no selector can reach
    // (FullWindowOverlay sheet inputs): map first, then coordinate-focus.
    const strokes = hidKeystrokesFor(value);
    if (focus) {
      await pressAt(this.#cfg.touchEndpoint, focus.x, focus.y, { signal: this.#cfg.signal });
      await sleep(800); // keyboard attach / focus settle
    }
    await typeKeystrokes(this.#cfg.touchEndpoint, strokes, LEFT_SHIFT_USAGE, {
      signal: this.#cfg.signal,
    });
    await sleep(400);
  }
  async clipboardSet(value: string): Promise<void> {
    const proc = Bun.spawn(['xcrun', 'simctl', 'pbcopy', this.#cfg.udid], { stdin: 'pipe' });
    await proc.stdin!.write(value);
    await proc.stdin!.end();
    assertSuccessfulExit('clipboard write', await proc.exited);
  }
  async clipboardGet(): Promise<string> {
    return run(['xcrun', 'simctl', 'pbpaste', this.#cfg.udid]);
  }
  async #captureScreenshot(mask: string[] = []): Promise<Uint8Array> {
    await sleep(this.#screenshotSettleMs); // banner tail + animation/content-shift settle
    const target = createPrivateScreenshotTarget(this.#screenshotTempRoot);
    const watcherWasRunning = await this.#ax.pause();
    try {
      const before = await this.#captureAxSnapshot();
      await this.#captureRawScreenshot(target.path);
      // If simctl replaced rather than truncated the pre-created file, restore
      // the file-level invariant before any host code reads the raw bitmap. The
      // enclosing 0700 directory protected it throughout the external write.
      chmodSync(target.path, 0o600);
      const after = await this.#captureAxSnapshot();
      this.#ax.update(after);
      const bytes = new Uint8Array(await Bun.file(target.path).arrayBuffer());
      // The remaining mask/compression work is memory-only. Remove raw pixels
      // immediately instead of retaining them until that work completes.
      target.cleanup();
      return await maskScreenshotBytes(bytes, before, mask, after);
    } catch (error) {
      const infrastructureError =
        error instanceof SimulatorInfrastructureError
          ? error
          : new SimulatorInfrastructureError(
              `simulator evidence transport unavailable: ${
                error instanceof Error ? error.message : String(error)
              }`,
              { cause: error }
            );
      this.#reportInfrastructureFailure?.(infrastructureError);
      throw infrastructureError;
    } finally {
      target.cleanup();
      if (watcherWasRunning && !this.#cfg.signal?.aborted) this.#ax.start();
    }
  }

  async screenshot(options: ScreenshotOptions = {}): Promise<Uint8Array> {
    if (options.delayMs) await sleep(options.delayMs);
    const first = await this.#captureScreenshot(options.mask);
    if (!options.stable) {
      if (options.tolerance !== undefined)
        throw new Error('screenshot tolerance requires stable:true');
      return first;
    }
    const tolerance = options.tolerance ?? 0.001;
    let previous = first;
    for (let attempt = 0; attempt < 4; attempt++) {
      await sleep(250);
      const current = await this.#captureScreenshot(options.mask);
      if ((await changedPixelFraction(previous, current)) <= tolerance) return current;
      previous = current;
    }
    throw new Error(`screenshot did not stabilize within tolerance ${tolerance}`);
  }
  async axSnapshot(): Promise<AxNode[]> {
    return (this.#ax.latest?.elements ?? []).map(toAxNode);
  }
  async observeState(): Promise<StateObservation> {
    const current = this.#ax.current();
    if (!current) return { state: 'unknown', revision: this.#ax.generation, ax: [] };
    return {
      state: classifyObservedState(current.snapshot),
      revision: current.generation,
      ax: current.snapshot.elements.map(toAxNode),
    };
  }
  async balance(unit: string): Promise<number> {
    if (unit !== 'sat') throw new Error(`unsupported balance unit: ${unit}`);
    const el = (this.#ax.latest?.elements ?? []).find((e) => /^-?₿/.test((e.label ?? '').trim()));
    if (!el) throw new Error('SAT balance is not observable in the accessibility snapshot');
    const balance = parseBalanceSat(el.label);
    if (balance === null) throw new Error(`SAT balance label could not be parsed`);
    return balance;
  }
  async transaction(ref: string): Promise<Record<string, unknown> | null> {
    const el = (this.#ax.latest?.elements ?? []).find(
      (candidate) => candidate.id === `transaction-probe-${ref}`
    );
    if (!el) return null;
    if (!el.value) throw new Error(`transaction probe "${ref}" has no accessibility value`);
    return parseTransactionProbe(el.value);
  }
}

export async function changedPixelFraction(a: Uint8Array, b: Uint8Array): Promise<number> {
  const [left, right] = await Promise.all([
    sharp(Buffer.from(a)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(Buffer.from(b)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (left.info.width !== right.info.width || left.info.height !== right.info.height) return 1;
  let changed = 0;
  const pixels = left.info.width * left.info.height;
  for (let i = 0; i < left.data.length; i += left.info.channels) {
    if (
      Math.abs(left.data[i] - right.data[i]) > 12 ||
      Math.abs(left.data[i + 1] - right.data[i + 1]) > 12 ||
      Math.abs(left.data[i + 2] - right.data[i + 2]) > 12
    ) {
      changed++;
    }
  }
  return pixels ? changed / pixels : 1;
}
