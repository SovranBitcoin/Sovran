/**
 * The Android emulator Driver. Same seam as SimulatorDriver, same PURE
 * matching/masking logic (ax.ts findElement, maskScreenshotBytes,
 * parseTransactionProbe) — only the transport differs: uiautomator dumps
 * instead of a serve-sim SSE stream, `adb shell input` instead of the HID/WS
 * bridge, `screencap` instead of `simctl io screenshot`.
 *
 * Offline-focused subset (M4): drag, clipboard, and permission `reset` throw
 * loudly — no scenario in the android lane uses them yet, and a loud throw
 * beats a silent wrong-primitive emulation.
 */
import type { AxNode, Driver, ScreenshotOptions, StateObservation } from '../driver';
import type { Selector } from '../../schema/selectors';
import {
  classifyObservedState,
  elementTapCenter,
  findElement,
  parseBalanceSat,
  toAxNode,
  type AxSnapshot,
} from '../ax';
import { sleep } from '../simctl';
import { SimulatorInfrastructureError } from '../simulator-session';
import {
  changedPixelFraction,
  fundedSweepProbeComplete,
  maskScreenshotBytes,
  maskWholeScreenshotBytes,
  parseTransactionProbe,
} from '../simulator';
import { E2E_READY_PROOF_STATUS_ID } from '../../../shared/lib/cashu/e2eReadyProofStatus';
import type { E2EReadyProofAsset } from '../../../shared/lib/cashu/e2eProofReconciliationConfig';
import type { Adb } from './adb';
import type { AndroidClipboardChannel } from './clipboard';
import { parseUiautomatorXml } from './ax-adapter';

const SHOT_SETTLE_MS = 450;
const REFRESH_CLEAR_MS = 1800;
const WALLET_TAB_SELECTOR = { id: 'tab-wallet' } as const;
const WALLET_READY_SELECTOR = { id: 'wallet-send' } as const;
/** A dump is ~0.5–1.5s of wall clock; that duration IS the poll interval, so
 * a fresh-snapshot loop needs no extra sleep beyond a small yield. */
const AX_FRESH_MS = 400;

/** Dump-on-demand AX source with single-flight coalescing and a freshness
 * window. Every input action invalidates; a monotonic generation feeds
 * observeState() revisions exactly like the iOS AxWatcher. */
export class AndroidAxSource {
  #adb: Adb;
  #snapshot: AxSnapshot | null = null;
  #takenAt = 0;
  #generation = 0;
  #inflight: Promise<AxSnapshot> | null = null;

  constructor(adb: Adb) {
    this.#adb = adb;
  }

  get generation(): number {
    return this.#generation;
  }

  get latest(): AxSnapshot | null {
    return this.#snapshot;
  }

  invalidate(): number {
    this.#snapshot = null;
    this.#takenAt = 0;
    return this.#generation;
  }

  async snapshot(maxAgeMs = AX_FRESH_MS): Promise<AxSnapshot> {
    if (this.#snapshot && Date.now() - this.#takenAt <= maxAgeMs) return this.#snapshot;
    this.#inflight ??= (async () => {
      try {
        const [xml, screen] = await Promise.all([
          this.#adb.uiautomatorDumpXml(),
          this.#adb.screenSize(),
        ]);
        const snap = parseUiautomatorXml(xml, screen);
        this.#snapshot = snap;
        this.#takenAt = Date.now();
        this.#generation += 1;
        return snap;
      } finally {
        this.#inflight = null;
      }
    })();
    return this.#inflight;
  }
}

const PERMISSION_MAP: Record<'camera' | 'photos' | 'location', string[]> = {
  camera: ['android.permission.CAMERA'],
  photos: ['android.permission.READ_MEDIA_IMAGES'],
  location: [
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
  ],
};

export interface AndroidDriverConfig {
  signal?: AbortSignal;
  pollMs?: number;
}

export interface AndroidDriverDeps {
  install: (reset: 'erase' | 'reinstall' | 'none') => Promise<void>;
  reportInfrastructureFailure?: (error: SimulatorInfrastructureError) => void;
  screenshotSettleMs?: number;
  refreshClearMs?: number;
  /** Host side of the in-app clipboard bridge; absent on fund-free sessions
   * that never touch the clipboard. */
  clipboard?: AndroidClipboardChannel;
}

export class AndroidDriver implements Driver {
  #adb: Adb;
  #cfg: AndroidDriverConfig;
  #ax: AndroidAxSource;
  #install: (reset: 'erase' | 'reinstall' | 'none') => Promise<void>;
  #reportInfrastructureFailure: ((error: SimulatorInfrastructureError) => void) | undefined;
  #screenshotSettleMs: number;
  #refreshClearMs: number;
  #clipboard: AndroidClipboardChannel | undefined;

  constructor(adb: Adb, cfg: AndroidDriverConfig, deps: AndroidDriverDeps) {
    this.#adb = adb;
    this.#cfg = cfg;
    this.#ax = new AndroidAxSource(adb);
    this.#install = deps.install;
    this.#reportInfrastructureFailure = deps.reportInfrastructureFailure;
    this.#screenshotSettleMs = deps.screenshotSettleMs ?? SHOT_SETTLE_MS;
    this.#refreshClearMs = deps.refreshClearMs ?? REFRESH_CLEAR_MS;
    this.#clipboard = deps.clipboard;
  }

  #throwIfAborted(): void {
    if (this.#cfg.signal?.aborted) throw this.#cfg.signal.reason;
  }

  async launch(reset: 'erase' | 'reinstall' | 'none'): Promise<void> {
    this.#throwIfAborted();
    this.#ax.invalidate();
    await this.#install(reset);
    await this.#ax.snapshot(0);
  }

  /** Inactive tab contents can remain present in the accessibility dump.
   * Always select the Wallet tab by id, then prove its active controls. */
  async #selectWalletTab(): Promise<void> {
    await this.waitFor(WALLET_TAB_SELECTOR, 'enabled', 45_000);
    await this.tap(WALLET_TAB_SELECTOR);
    await this.waitFor(WALLET_READY_SELECTOR, undefined, 45_000);
  }

  async home(): Promise<void> {
    await this.launch('none');
    await this.#selectWalletTab();
    await sleep(this.#refreshClearMs); // let the post-reload "Refreshing…" overlay clear
  }

  /** Funded reconciliation: relaunch and wait until the app's ready-proof
   * status probe reports every externally-swept asset reconciled, then settle
   * on the wallet. Mirrors SimulatorDriver.homeAfterFundedSweep — the funded
   * runtime's refreshApp callback drives this after a host-side sweep. */
  async homeAfterFundedSweep(expectedAssets: readonly E2EReadyProofAsset[]): Promise<void> {
    await this.launch('none');
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
    throw new Error('android app did not reconcile externally swept ready proofs before timeout');
  }

  /** Runtime permission control. Unlike iOS TCC there is no "reset to
   * not-determined" without `pm clear`, which would wipe app data — loud
   * throw so a scenario can never believe it reset a permission. */
  async setPermission(
    service: 'camera' | 'photos' | 'location',
    mode: 'grant' | 'revoke' | 'reset'
  ): Promise<void> {
    this.#throwIfAborted();
    if (mode === 'reset') {
      throw new Error('permission reset is unsupported on the android driver (needs pm clear)');
    }
    for (const permission of PERMISSION_MAP[service]) {
      if (mode === 'grant') await this.#adb.pmGrant(permission);
      else await this.#adb.pmRevoke(permission);
    }
  }

  /** No adb-only equivalent of a simulated GPS fix (needs the emulator
   * console) — loud throw so a scenario never believes a fix was seeded. */
  async setLocation(): Promise<void> {
    this.#throwIfAborted();
    throw new Error('location simulation is unsupported on the android driver');
  }

  async openUrl(url: string): Promise<void> {
    this.#throwIfAborted();
    this.#ax.invalidate();
    await this.#adb.openUrl(url);
  }

  /** A system dialog (GMS "Location Accuracy" prompt, ANR "isn't
   * responding") takes the top window, and Android's `uiautomator dump`
   * returns ONLY the topmost window — so the app's entire tree, banner and
   * all, goes invisible until it is dismissed. Detect the signature and tap
   * the negative/neutral button (`android:id/button2`, then button3), then
   * report that the snapshot should be retaken. The app analog of iOS's
   * handleDevClientChrome. Returns true if a dialog was dismissed. */
  async #dismissSystemInterrupt(snap: AxSnapshot): Promise<boolean> {
    const isSystemDialog = snap.elements.some(
      (el) =>
        (el.id ?? '').startsWith('com.google.android.gms:id/') ||
        (el.id ?? '') === 'android:id/aerr_wait' ||
        /Location Accuracy|isn't responding/i.test(el.label ?? '')
    );
    if (!isSystemDialog) return false;
    const dismiss =
      snap.elements.find((el) => el.id === 'android:id/button2') ??
      snap.elements.find((el) => el.id === 'android:id/button3') ??
      snap.elements.find((el) => /^(No thanks|Cancel|Deny|Wait|Close)$/i.test(el.label ?? ''));
    if (!dismiss) return false;
    await this.#adb.tap(
      (dismiss.frame.x + dismiss.frame.width / 2) / snap.screen.width,
      (dismiss.frame.y + dismiss.frame.height / 2) / snap.screen.height
    );
    this.#ax.invalidate();
    await sleep(600);
    return true;
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
      const snap = await this.#ax.snapshot(0).catch(() => null);
      if (snap) {
        if (await this.#dismissSystemInterrupt(snap)) continue;
        const el = findElement(snap, sel);
        if (el && (state !== 'enabled' || el.enabled !== false)) {
          const node = toAxNode(el);
          if (value === undefined || node.value === value) return node;
        }
      }
      await sleep(this.#cfg.pollMs ?? 100);
    }
    throw new Error(
      `timed out after ${timeoutMs}ms waiting for ${JSON.stringify(sel)}${
        value === undefined ? '' : ` with value "${value}"`
      }`
    );
  }

  async find(sel: Selector): Promise<AxNode | null> {
    let snap = await this.#ax.snapshot().catch(() => null);
    // find() is the resolution path for tapUntil's until-check and retry
    // tap-guard, so a system dialog stalling on top would make every find()
    // return null forever (the app tree is hidden). Dismiss it and re-dump
    // once so the real tree is visible — idempotent, fires only on an actual
    // system window.
    if (snap && (await this.#dismissSystemInterrupt(snap))) {
      snap = await this.#ax.snapshot(0).catch(() => null);
    }
    if (!snap) return null;
    const el = findElement(snap, sel);
    return el ? toAxNode(el) : null;
  }

  async #waitCenter(sel: Selector, timeoutMs = 4000): Promise<{ x: number; y: number } | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.#throwIfAborted();
      const snap = await this.#ax.snapshot(0).catch(() => null);
      if (snap) {
        if (await this.#dismissSystemInterrupt(snap)) continue;
        const el = findElement(snap, sel);
        if (el) {
          return elementTapCenter(el, snap.screen);
        }
      }
      await sleep(this.#cfg.pollMs ?? 100);
    }
    return null;
  }

  async tap(sel: Selector): Promise<void> {
    const center = await this.#waitCenter(sel);
    if (!center) throw new Error(`tap: selector not on screen ${JSON.stringify(sel)}`);
    this.#ax.invalidate();
    await this.#adb.tap(center.x, center.y);
  }

  async tapAt(x: number, y: number): Promise<void> {
    this.#throwIfAborted();
    this.#ax.invalidate();
    await this.#adb.tap(x, y);
  }

  async swipe(dir: 'left' | 'right' | 'up' | 'down'): Promise<void> {
    this.#throwIfAborted();
    const [from, to] =
      dir === 'left'
        ? [
            { x: 0.85, y: 0.5 },
            { x: 0.15, y: 0.5 },
          ]
        : dir === 'right'
          ? [
              { x: 0.15, y: 0.5 },
              { x: 0.85, y: 0.5 },
            ]
          : dir === 'up'
            ? [
                { x: 0.5, y: 0.7 },
                { x: 0.5, y: 0.3 },
              ]
            : [
                { x: 0.5, y: 0.3 },
                { x: 0.5, y: 0.7 },
              ];
    this.#ax.invalidate();
    await this.#adb.swipe(from, to, 250);
  }

  /** Drag within an element's bounds (slide-to-confirm). from/to are
   * fractions of the element frame, matching the iOS driver's contract; a
   * long `adb input swipe` duration reads as a drag, not a fling. */
  async drag(
    sel: Selector,
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs = 800
  ): Promise<void> {
    const deadline = Date.now() + 4000;
    let el = null as ReturnType<typeof findElement>;
    let snap: AxSnapshot | null = null;
    while (Date.now() < deadline) {
      this.#throwIfAborted();
      snap = await this.#ax.snapshot(0).catch(() => null);
      if (snap && (await this.#dismissSystemInterrupt(snap))) continue;
      el = snap ? findElement(snap, sel) : null;
      if (snap && el) break;
      await sleep(this.#cfg.pollMs ?? 100);
    }
    if (!snap || !el) throw new Error(`drag: selector not on screen ${JSON.stringify(sel)}`);
    const point = (f: { x: number; y: number }) => ({
      x: (el!.frame.x + el!.frame.width * f.x) / snap!.screen.width,
      y: (el!.frame.y + el!.frame.height * f.y) / snap!.screen.height,
    });
    this.#ax.invalidate();
    await this.#adb.swipe(point(from), point(to), durationMs);
  }

  async input(sel: Selector, value: string): Promise<void> {
    // The whole string is charset-validated inside typeText BEFORE the field
    // is touched, so an unmappable character can never leave a half-typed
    // field. Focus is proven with a benign digit probe exactly like iOS —
    // unfocused input text would type into whatever holds focus.
    await this.tap(sel);
    await sleep(800); // keyboard attach / autofocus settle
    let focused = false;
    for (let attempt = 0; attempt < 4 && !focused; attempt++) {
      await this.#adb.typeText('1');
      try {
        await this.waitFor(sel, undefined, 2_000, '1');
        focused = true;
      } catch {
        await this.tap(sel);
        await sleep(800);
      }
    }
    if (!focused) throw new Error(`input: field never took focus ${JSON.stringify(sel)}`);
    // Clear the probe digit, then type the real value.
    await this.#adb.keyevent(67); // KEYCODE_DEL
    this.#ax.invalidate();
    await this.#adb.typeText(value);
    await sleep(400);
  }

  async typeText(value: string, focus?: { x: number; y: number }): Promise<void> {
    if (focus) {
      await this.tapAt(focus.x, focus.y);
      await sleep(800);
    }
    this.#ax.invalidate();
    await this.#adb.typeText(value);
    await sleep(400);
  }

  async clipboardSet(value: string): Promise<void> {
    this.#throwIfAborted();
    if (!this.#clipboard) throw new Error('android clipboard bridge is not configured');
    await this.#clipboard.set(value);
  }

  async clipboardGet(): Promise<string> {
    this.#throwIfAborted();
    if (!this.#clipboard) throw new Error('android clipboard bridge is not configured');
    return this.#clipboard.get();
  }

  async #captureScreenshot(mask: string[] = []): Promise<Uint8Array> {
    await sleep(this.#screenshotSettleMs);
    // Bracket screencap with AX geometry. UIAutomator can be unreadable during
    // continuous animation; that degrades to a full black frame below. Only a
    // screencap-bytes failure is a real infrastructure fault.
    const empty: AxSnapshot = { screen: { width: 0, height: 0 }, elements: [] };
    const before = await this.#ax.snapshot(0).catch(() => empty);
    let bytes: Uint8Array;
    try {
      bytes = await this.#adb.screencapPng();
    } catch (error) {
      const infrastructureError =
        error instanceof SimulatorInfrastructureError
          ? error
          : new SimulatorInfrastructureError(
              `android evidence transport unavailable: ${
                error instanceof Error ? error.message : String(error)
              }`,
              { cause: error }
            );
      this.#reportInfrastructureFailure?.(infrastructureError);
      throw infrastructureError;
    }
    this.#ax.invalidate();
    const after = await this.#ax.snapshot(0).catch(() => empty);
    // Unknown geometry can never prove that a secret field was absent when the
    // bitmap was sampled. Preserve the evidence boundary by blacking the full
    // frame instead of emitting possibly-secret pixels.
    if (before.elements.length === 0 || after.elements.length === 0)
      return maskWholeScreenshotBytes(bytes);
    return maskScreenshotBytes(bytes, before, mask, after);
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
    const snap = await this.#ax.snapshot().catch(() => null);
    return (snap?.elements ?? []).map(toAxNode);
  }

  async observeState(): Promise<StateObservation> {
    const snap = await this.#ax.snapshot(0).catch(() => null);
    if (!snap) return { state: 'unknown', revision: this.#ax.generation, ax: [] };
    return {
      state: classifyObservedState(snap),
      revision: this.#ax.generation,
      ax: snap.elements.map(toAxNode),
    };
  }

  async balance(unit: string): Promise<number> {
    if (unit !== 'sat') throw new Error(`unsupported balance unit: ${unit}`);
    const snap = await this.#ax.snapshot();
    const el = snap.elements.find((candidate) => /^-?₿/.test((candidate.label ?? '').trim()));
    if (!el) throw new Error('SAT balance is not observable in the accessibility snapshot');
    const balance = parseBalanceSat(el.label);
    if (balance === null) throw new Error('SAT balance label could not be parsed');
    return balance;
  }

  async transaction(ref: string): Promise<Record<string, unknown> | null> {
    const snap = await this.#ax.snapshot();
    const el = snap.elements.find((candidate) => candidate.id === `transaction-probe-${ref}`);
    if (!el) return null;
    if (!el.value) throw new Error(`transaction probe "${ref}" has no accessibility value`);
    return parseTransactionProbe(el.value);
  }
}
