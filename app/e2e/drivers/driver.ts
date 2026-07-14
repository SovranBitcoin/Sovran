/**
 * The device driver seam. The orchestrator (core/run.ts) talks only to these
 * interfaces, so the whole run pipeline — events, artifacts, ledger, cleanup —
 * is exercised offline against `FakeDriver`. The real `SimulatorDriver` (simctl
 * + serve-sim /ax + gesture) plugs into the same interface only through an
 * owned ephemeral session. `clipboardSet`
 * takes an already safe/opaque value; AX/text is redacted, while bitmaps are
 * owner-private and masked only when a checkpoint explicitly requests it.
 */
import type { Selector } from '../schema/selectors';

export interface AxNode {
  id?: string;
  label?: string;
  value?: string;
  role?: string;
  state?: Record<string, boolean>;
}

export interface ScreenshotOptions {
  delayMs?: number;
  mask?: string[];
  stable?: boolean;
  /** Maximum fraction of pixels that may differ between stable frames. */
  tolerance?: number;
}

export type ObservedState = 'wallet' | 'onboarding' | 'unknown';

export interface StateObservation {
  state: ObservedState;
  /** Monotonic fresh accessibility-observation generation used to reject cached polls. */
  revision: number;
  /** Nodes classified for this exact revision, not a later cache read. */
  ax: AxNode[];
}

export interface Driver {
  launch(reset: 'erase' | 'reinstall' | 'none'): Promise<void>;
  home(): Promise<void>;
  waitFor(
    sel: Selector,
    state: 'visible' | 'enabled' | undefined,
    timeoutMs: number
  ): Promise<AxNode>;
  find(sel: Selector): Promise<AxNode | null>;
  tap(sel: Selector): Promise<void>;
  tapAt(x: number, y: number): Promise<void>;
  swipe(dir: 'left' | 'right' | 'up' | 'down'): Promise<void>;
  drag(
    sel: Selector,
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs?: number
  ): Promise<void>;
  input(sel: Selector, value: string): Promise<void>;
  clipboardSet(value: string): Promise<void>;
  clipboardGet(): Promise<string>;
  screenshot(options?: ScreenshotOptions): Promise<Uint8Array>;
  axSnapshot(): Promise<AxNode[]>;
  observeState(): Promise<StateObservation>;
  balance(unit: string): Promise<number>;
  transaction(ref: string): Promise<Record<string, unknown> | null>;
}

export interface CommandResult {
  code: number;
  stdout: string;
}
export interface CommandRunner {
  run(command: string[], timeoutMs: number): Promise<CommandResult>;
}

export interface ArtifactSink {
  /** Persist an artifact and return its (redacted-safe) path. */
  write(rel: string, kind: 'screenshot' | 'ax' | 'log', data: Uint8Array | string): string;
}

export const selectorKey = (s: Selector): string =>
  'id' in s ? `id:${s.id}` : 'idPrefix' in s ? `idPrefix:${s.idPrefix}` : `label:${s.label}`;

// ── Fakes for offline orchestrator tests ────────────────────────────────────

export interface FakeConfig {
  present?: Record<string, AxNode>; // selectorKey -> node currently on screen
  failWaitFor?: string[]; // selectorKeys whose waitFor times out
  balances?: Record<string, number>;
  txs?: Record<string, Record<string, unknown>>;
  currentState?: ObservedState;
  observedStates?: ObservedState[];
  /** Override generated observation revisions; the final value repeats. */
  observedStateRevisions?: number[];
  failScreenshot?: boolean;
  /** Permissive mode for a pipeline smoke: every selector resolves to a
   *  button-like node and every waitFor succeeds — proves orchestration +
   *  reporters + artifacts without a device, never a real assertion. */
  permissive?: boolean;
}

export class FakeDriver implements Driver {
  calls: string[] = [];
  screenshotOptions: ScreenshotOptions[] = [];
  clipboard = '';
  #cfg: FakeConfig;
  #observedStateIndex = 0;
  #observedRevision = 0;
  constructor(cfg: FakeConfig = {}) {
    this.#cfg = cfg;
  }
  #match(sel: Selector): AxNode | null {
    if (this.#cfg.permissive) {
      const id =
        'id' in sel ? sel.id : 'idPrefix' in sel ? `${sel.idPrefix}fake-suffix` : undefined;
      return {
        id,
        label: 'label' in sel ? sel.label : id,
        role: 'button',
        value: '',
        state: { enabled: true },
      };
    }
    const present = this.#cfg.present ?? {};
    const key = selectorKey(sel);
    if ('idPrefix' in sel) {
      const matches = Object.entries(present).flatMap(([candidateKey, candidate]) => {
        const id = candidate.id ?? (candidateKey.startsWith('id:') ? candidateKey.slice(3) : '');
        return id.startsWith(sel.idPrefix) ? [{ ...candidate, id }] : [];
      });
      if (sel.captureSuffixAs && matches.length > 1)
        throw new Error(
          `ambiguous id prefix capture "${sel.idPrefix}" (${matches.length} matches)`
        );
      if (sel.captureSuffixAs && matches[0]?.id === sel.idPrefix)
        throw new Error(`empty id suffix for prefix capture "${sel.idPrefix}"`);
      if (matches[0]) return matches[0];
    }
    if (present[key]) return present[key];
    return null;
  }
  async launch(reset: 'erase' | 'reinstall' | 'none') {
    this.calls.push(`launch:${reset}`);
  }
  async home() {
    this.calls.push('home');
  }
  async waitFor(sel: Selector, state: 'visible' | 'enabled' | undefined, _t: number) {
    this.calls.push(`waitFor:${selectorKey(sel)}`);
    if ((this.#cfg.failWaitFor ?? []).includes(selectorKey(sel)))
      throw new Error(`timed out waiting for ${selectorKey(sel)}`);
    const node = this.#match(sel);
    if (!node) throw new Error(`waitFor: ${selectorKey(sel)} not present`);
    if (state === 'enabled' && node.state?.enabled === false)
      throw new Error(`waitFor: ${selectorKey(sel)} not enabled`);
    return node;
  }
  async find(sel: Selector) {
    return this.#match(sel);
  }
  async tap(sel: Selector) {
    this.calls.push(`tap:${selectorKey(sel)}`);
  }
  async tapAt(x: number, y: number) {
    this.calls.push(`tapAt:${x},${y}`);
  }
  async swipe(dir: 'left' | 'right' | 'up' | 'down') {
    this.calls.push(`swipe:${dir}`);
  }
  async drag(
    sel: Selector,
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs?: number
  ) {
    this.calls.push(
      `drag:${selectorKey(sel)}:${from.x},${from.y}->${to.x},${to.y}:${durationMs ?? 400}`
    );
  }
  async input(sel: Selector, value: string) {
    this.calls.push(`input:${selectorKey(sel)}=${value}`);
  }
  async clipboardSet(value: string) {
    this.clipboard = value;
    this.calls.push('clipboardSet');
  }
  async clipboardGet() {
    return this.#cfg.permissive ? 'lnbc-fake-invoice' : this.clipboard;
  }
  async screenshot(options: ScreenshotOptions = {}) {
    this.screenshotOptions.push(options);
    if (this.#cfg.failScreenshot) throw new Error('fake screenshot failed');
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  }
  async axSnapshot() {
    return Object.values(this.#cfg.present ?? {});
  }
  async observeState(): Promise<StateObservation> {
    this.calls.push('observeState');
    const index = this.#observedStateIndex++;
    const states = this.#cfg.observedStates;
    const state = states?.length
      ? states[Math.min(index, states.length - 1)]
      : (this.#cfg.currentState ?? 'wallet');
    const revisions = this.#cfg.observedStateRevisions;
    const revision = revisions?.length
      ? revisions[Math.min(index, revisions.length - 1)]
      : ++this.#observedRevision;
    return { state, revision, ax: Object.values(this.#cfg.present ?? {}) };
  }
  async balance(unit: string) {
    if (!this.#cfg.balances || !(unit in this.#cfg.balances))
      throw new Error(`unsupported or unconfigured balance unit: ${unit}`);
    return this.#cfg.balances[unit];
  }
  async transaction(ref: string) {
    return this.#cfg.txs?.[ref] ?? null;
  }
}

export class FakeCommandRunner implements CommandRunner {
  calls: string[][] = [];
  constructor(private outputs: Record<string, string> = {}) {}
  async run(command: string[], _t: number): Promise<CommandResult> {
    this.calls.push(command);
    return { code: 0, stdout: this.outputs[command.join(' ')] ?? '' };
  }
}

export class MemoryArtifactSink implements ArtifactSink {
  written: { rel: string; kind: string; bytes: number }[] = [];
  write(rel: string, kind: 'screenshot' | 'ax' | 'log', data: Uint8Array | string): string {
    this.written.push({ rel, kind, bytes: typeof data === 'string' ? data.length : data.length });
    return `artifacts/${rel}`;
  }
}
