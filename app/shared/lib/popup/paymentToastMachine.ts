/**
 * The payment toast state machine: which toasts are on screen, in which phase,
 * and for how long. Pure (no React, no stores, no navigation): callers report
 * what they know about a payment under its key and read back the list of
 * toasts to draw. Every timing rule of the toast lives here.
 *
 * One toast per payment key, updated in place. Each toast keeps its own
 * timers, so nothing another toast does can move them.
 *
 *   start ──(result within spinnerDelay)──────────────► result
 *     │
 *     └─ spinnerDelay ─► working ─► handed-off ─┐
 *                           │  └──► slow ───────┼─ closeAfter ─► parked
 *                           │ (workingMax)      │                  │ result
 *                           ▼                   ▼                  ▼
 *                         done / failed ◄───────┴──────────────────┘
 *                           │  failed ─► done (a late success corrects it)
 *                           └─ resultMs ─► finished (remembered, never replayed)
 *
 * A visible state stays at least `minVisibleMs`; reports that arrive sooner are
 * coalesced to the latest. New wording for the same spinner (the next step of
 * a swap) waits `spinnerDelayMs` like a start does, so a step that ends at
 * once is never drawn: it is merged into whatever follows it.
 */

import type { PaymentPhase } from 'wallet';

/** Phases a toast can be in. `cancelled` is never drawn: it dismisses. */
type ToastPhase = Exclude<PaymentPhase, 'cancelled'>;

export interface ToastTiming {
  /**
   * A result that arrives within this of the start is shown with no spinner
   * first. The same wait applies to each later step of a spinner.
   */
  spinnerDelayMs: number;
  /** The least time any state stays on screen before the next replaces it. */
  minVisibleMs: number;
  /** How long a result (done / failed) stays before the toast closes. */
  resultMs: number;
  /** How long "waiting on the other side" / "taking long" stays before closing. */
  closeAfterMs: number;
  /** A spinner never outlives this: it turns `slow` and closes. */
  workingMaxMs: number;
}

export const TOAST_TIMING: ToastTiming = {
  spinnerDelayMs: 400,
  minVisibleMs: 600,
  resultMs: 3000,
  closeAfterMs: 3000,
  workingMaxMs: 2 * 60_000,
};

/** Results remembered after their toast closed, so a repeat is not shown again. */
const MAX_FINISHED = 50;
/** Toasts tracked off screen, waiting for their payment's result. */
const MAX_PARKED = 30;

export interface ToastView<C> {
  /** Stable for the life of the toast, across re-keying. */
  id: string;
  key: string;
  phase: ToastPhase;
  content: C;
}

/** The transaction screen in front, if any: its toasts stay quiet. */
export interface ToastFocus {
  /** Identifies this focused screen instance. */
  token: string;
  /** Ids (quote, operation, entry) of the transaction it shows. */
  ids: readonly string[];
}

interface ReportOptions {
  /** Ids of the payment (quote, operation, entry), matched against the focused screen. */
  ids?: readonly string[];
  /**
   * When the payment's own key is not known to any toast yet, hold this result
   * while an unbound toast of this group is still working: it may be that
   * toast's own, and `bind` hands it over.
   */
  holdForGroup?: string;
}

interface StartOptions {
  ids?: readonly string[];
  /** The key is only the starter's: the payment's real key comes with `bind`. */
  unbound?: { group: string };
  /** Started from the screen in focus: quiet while that screen stays in front. */
  fromFocus?: boolean;
  /** When (ms epoch) the spinner should turn `slow`, if sooner than `workingMaxMs`. */
  slowAt?: number;
}

interface MachineOptions<C> {
  timing?: Partial<ToastTiming>;
  /** The toasts to draw, oldest first. Called whenever the list changes. */
  onChange: (views: ToastView<C>[]) => void;
  /** A toast's payment ended and its toast is gone for good. */
  onFinished?: (toast: { key: string; phase: ToastPhase; content: C }) => void;
  /** Whether two contents draw the same; defaults to a JSON comparison. */
  sameContent?: (a: C, b: C) => boolean;
}

interface Shown<C> {
  phase: ToastPhase;
  content: C;
  /** When what is drawn last changed. */
  since: number;
  /** When this phase was first drawn: its lifetime is measured from here. */
  phaseSince: number;
}

interface Rec<C> {
  id: string;
  key: string;
  ids: Set<string>;
  phase: ToastPhase;
  content: C;
  createdAt: number;
  /** When `phase` / `content` last changed. */
  knownSince: number;
  shown: Shown<C> | null;
  /** Off screen but tracked; only a result brings it back. */
  parked: boolean;
  unboundGroup: string | null;
  focusToken: string | null;
  slowAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const isResult = (phase: ToastPhase) => phase === 'done' || phase === 'failed';

/** Whether a toast in `from` may move to `to`. A payment only moves forward,
 *  except that a success always wins over an earlier failure. */
function accepts(from: ToastPhase, to: ToastPhase): boolean {
  if (from === to) return true;
  switch (from) {
    case 'working':
      return true;
    case 'handed-off':
      return to === 'slow' || isResult(to);
    case 'slow':
      return isResult(to);
    case 'failed':
      return to === 'done';
    case 'done':
      return false;
  }
}

export function createPaymentToastMachine<C>(options: MachineOptions<C>) {
  const timing: ToastTiming = { ...TOAST_TIMING, ...options.timing };
  const sameContent =
    options.sameContent ?? ((a: C, b: C) => JSON.stringify(a) === JSON.stringify(b));
  const recs = new Map<string, Rec<C>>();
  const finished = new Map<string, ToastPhase>();
  const held = new Map<
    string,
    { group: string; phase: ToastPhase; content: C; ids?: readonly string[] }
  >();
  let focus: ToastFocus | null = null;
  let sequence = 0;
  let lastEmitted = '[]';

  const suppressed = (rec: Rec<C>) =>
    focus !== null &&
    (rec.focusToken === focus.token || focus.ids.some((id) => rec.ids.has(id)));

  function views(): ToastView<C>[] {
    const list: ToastView<C>[] = [];
    for (const rec of recs.values()) {
      if (!rec.shown || suppressed(rec)) continue;
      list.push({ id: rec.id, key: rec.key, phase: rec.shown.phase, content: rec.shown.content });
    }
    return list;
  }

  function emit(): void {
    const next = views();
    const signature = JSON.stringify(next);
    if (signature === lastEmitted) return;
    lastEmitted = signature;
    options.onChange(next);
  }

  function clearTimer(rec: Rec<C>): void {
    if (rec.timer !== null) clearTimeout(rec.timer);
    rec.timer = null;
  }

  function at(rec: Rec<C>, when: number, run: () => void): void {
    rec.timer = setTimeout(
      () => {
        rec.timer = null;
        run();
        emit();
      },
      Math.max(0, when - Date.now())
    );
  }

  function remember(key: string, phase: ToastPhase): void {
    finished.delete(key);
    finished.set(key, phase);
    for (const stale of [...finished.keys()].slice(0, -MAX_FINISHED)) finished.delete(stale);
  }

  function remove(rec: Rec<C>): void {
    clearTimer(rec);
    recs.delete(rec.key);
  }

  /** The payment ended and its toast leaves: it is not shown again. */
  function finish(rec: Rec<C>): void {
    remove(rec);
    remember(rec.key, rec.phase);
    options.onFinished?.({ key: rec.key, phase: rec.phase, content: rec.content });
    releaseHeld();
  }

  /** Off screen, still tracked: its result will bring it back. */
  function park(rec: Rec<C>): void {
    clearTimer(rec);
    rec.shown = null;
    rec.parked = true;
    const parked = [...recs.values()].filter((r) => r.parked);
    for (const stale of parked.slice(0, -MAX_PARKED)) remove(stale);
    releaseHeld();
  }

  function draw(rec: Rec<C>): void {
    const now = Date.now();
    const samePhase = rec.shown?.phase === rec.phase;
    rec.shown = {
      phase: rec.phase,
      content: rec.content,
      since: now,
      phaseSince: samePhase && rec.shown ? rec.shown.phaseSince : now,
    };
    rec.parked = false;
  }

  /** Bring what is drawn in line with what is known, and set the next timer. */
  function settle(rec: Rec<C>): void {
    clearTimer(rec);
    const now = Date.now();
    if (!rec.shown) {
      if (rec.parked) {
        if (!isResult(rec.phase)) return;
      } else if (rec.phase === 'working') {
        const spinnerAt = rec.createdAt + timing.spinnerDelayMs;
        if (now < spinnerAt) return at(rec, spinnerAt, () => settle(rec));
      }
      draw(rec);
    } else if (rec.shown.phase !== rec.phase || !sameContent(rec.shown.content, rec.content)) {
      const nextStep = rec.shown.phase === 'working' && rec.phase === 'working';
      const due = Math.max(
        rec.shown.since + timing.minVisibleMs,
        nextStep ? rec.knownSince + timing.spinnerDelayMs : 0
      );
      if (now < due) return at(rec, due, () => settle(rec));
      draw(rec);
    }
    const shown = rec.shown!;
    switch (shown.phase) {
      case 'working': {
        const slowAt = Math.min(
          rec.slowAt ?? Number.POSITIVE_INFINITY,
          shown.phaseSince + timing.workingMaxMs
        );
        return at(rec, slowAt, () => {
          rec.phase = 'slow';
          settle(rec);
          releaseHeld();
        });
      }
      case 'handed-off':
      case 'slow':
        return at(rec, shown.phaseSince + timing.closeAfterMs, () => park(rec));
      case 'done':
      case 'failed':
        return at(rec, shown.phaseSince + timing.resultMs, () => finish(rec));
    }
  }

  const waitingUnbound = (group: string) =>
    [...recs.values()].some(
      (rec) => rec.unboundGroup === group && rec.phase === 'working' && !rec.parked
    );

  /** Results held for an unbound toast that is no longer waiting get their own toast. */
  function releaseHeld(): void {
    for (const [key, result] of [...held]) {
      if (waitingUnbound(result.group)) continue;
      held.delete(key);
      report(key, result.phase, result.content, result.ids ? { ids: result.ids } : {});
    }
  }

  function create(key: string, phase: ToastPhase, content: C, opts: StartOptions): Rec<C> {
    sequence += 1;
    const rec: Rec<C> = {
      id: `payment-toast-${sequence}`,
      key,
      ids: new Set(opts.ids ?? []),
      phase,
      content,
      createdAt: Date.now(),
      knownSince: Date.now(),
      shown: null,
      parked: false,
      unboundGroup: opts.unbound?.group ?? null,
      focusToken: opts.fromFocus ? (focus?.token ?? null) : null,
      slowAt: opts.slowAt ?? null,
      timer: null,
    };
    recs.set(key, rec);
    return rec;
  }

  /**
   * A payment begins: show its toast, spinning once `spinnerDelayMs` has passed
   * without a result. A payment already being shown is not started twice, and a
   * payment already seen to succeed is not shown again; one that failed or went
   * quiet starts afresh (a retry).
   */
  function start(key: string, content: C, opts: StartOptions = {}): void {
    const existing = recs.get(key);
    if (existing?.phase === 'working' || existing?.phase === 'done') return;
    if (!existing && finished.get(key) === 'done') return;
    if (existing) remove(existing);
    finished.delete(key);
    settle(create(key, 'working', content, opts));
    emit();
  }

  /**
   * What is now known about the payment `key`. Updates its toast in place; with
   * no toast, a result or a wait gets one of its own. `cancelled` dismisses.
   */
  function report(key: string, phase: PaymentPhase, content: C, opts: ReportOptions = {}): void {
    if (phase === 'cancelled') return dismiss(key);
    const rec = recs.get(key);
    if (!rec) {
      const seen = finished.get(key);
      // Shown already, or a stale report about a payment that ended.
      if (seen !== undefined && !(seen === 'failed' && phase === 'done')) return;
      if (opts.holdForGroup !== undefined && waitingUnbound(opts.holdForGroup)) {
        held.set(key, {
          group: opts.holdForGroup,
          phase,
          content,
          ...(opts.ids ? { ids: opts.ids } : {}),
        });
        return;
      }
      finished.delete(key);
      const created = create(key, phase, content, opts.ids ? { ids: opts.ids } : {});
      // Nothing was on screen for it: there is no spinner to wait out.
      created.createdAt = Number.NEGATIVE_INFINITY;
      settle(created);
      return emit();
    }
    for (const id of opts.ids ?? []) rec.ids.add(id);
    if (accepts(rec.phase, phase)) {
      if (rec.phase !== phase || !sameContent(rec.content, content)) rec.knownSince = Date.now();
      rec.phase = phase;
      rec.content = content;
      settle(rec);
      releaseHeld();
    }
    emit();
  }

  /**
   * The toast started under `from` belongs to the payment `to`. A result that
   * arrived for `to` before this (held, or in a toast of its own) lands on it.
   */
  function bind(from: string, to: string, ids: readonly string[] = []): void {
    const rec = recs.get(from);
    if (!rec || from === to) return;
    const other = recs.get(to);
    const early =
      held.get(to) ?? (other ? { phase: other.phase, content: other.content } : undefined);
    held.delete(to);
    if (other) remove(other);
    recs.delete(from);
    // Its result was already shown and closed in a toast of its own.
    if (!early && finished.get(to) === 'done') {
      clearTimer(rec);
      releaseHeld();
      return emit();
    }
    rec.key = to;
    rec.unboundGroup = null;
    for (const id of ids) rec.ids.add(id);
    recs.set(to, rec);
    if (early && accepts(rec.phase, early.phase)) {
      rec.phase = early.phase;
      rec.content = early.content;
    }
    settle(rec);
    releaseHeld();
    emit();
  }

  /** The payment was cancelled or cleared: its toast goes, and nothing is remembered. */
  function dismiss(key: string): void {
    const rec = recs.get(key);
    held.delete(key);
    if (!rec) return;
    remove(rec);
    releaseHeld();
    emit();
  }

  /** Every toast goes (profile switch): nothing carries over. */
  function dismissAll(): void {
    for (const rec of [...recs.values()]) remove(rec);
    held.clear();
    finished.clear();
    emit();
  }

  /**
   * The person removed the toast `id` (a swipe, a tap). A result is finished
   * with; a toast still in flight is only parked, so its result is still told.
   */
  function userDismissed(id: string): void {
    const rec = [...recs.values()].find((r) => r.id === id);
    if (!rec || !rec.shown) return;
    if (isResult(rec.phase)) finish(rec);
    else park(rec);
    emit();
  }

  /** Which transaction screen is in front; null when none is. */
  function setFocus(next: ToastFocus | null): void {
    focus = next;
    emit();
  }

  return { start, report, bind, dismiss, dismissAll, userDismissed, setFocus, views };
}

export type PaymentToastMachine<C> = ReturnType<typeof createPaymentToastMachine<C>>;
