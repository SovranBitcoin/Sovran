import { createPageBuffer, type SortKey } from './page-buffer';

export type { SortKey } from './page-buffer';

// ---------------------------------------------------------------------------
// SurfaceSession — one paginated, live-aware surface over a PageBuffer
//
// This is the engine behind the relay-mode trick: a caller drives a normal
// paginated API (firstPage / loadOlder / loadNew) while a background listener
// streams newer items that are WITHHELD behind `pendingNew` until an explicit
// `loadNew`. The same engine serves every tier — only the injected `fetchPage`
// and (optional) `liveSubscribe` differ. nagg/primal pass paginated fetch with
// no listener (so `pendingNew` stays 0 and the shape is identical); the relay
// tier passes both. The app never knows which answered.
//
// Listener bursts are conflated through an injected `schedule` (a settle window)
// so concurrent relay delivery collapses into ONE `offerNew` per tick.
// ---------------------------------------------------------------------------

export type PageBound = { until?: SortKey; limit: number };
export type FetchPage<T> = (bound: PageBound) => Promise<readonly T[]>;
/** Subscribe to items NEWER than `since`; returns an unsubscribe. */
export type LiveSubscribe<T> = (
  since: SortKey | undefined,
  onItems: (items: readonly T[]) => void,
) => () => void;

/** Schedule a one-shot flush (the settle window); returns a cancel. Injected for determinism. */
export type Scheduler = (flush: () => void) => () => void;

export type SurfaceSessionOptions<T> = {
  keyOf: (item: T) => SortKey;
  fetchPage: FetchPage<T>;
  liveSubscribe?: LiveSubscribe<T>;
  pageSize?: number;
  schedule?: Scheduler;
};

export interface SurfaceSession<T> {
  /** Fetch the first page, freeze the cutoff, and start the listener. */
  firstPage(): Promise<ReadonlyArray<T>>;
  /** Fetch the next older page; grows the bottom without reshuffle. */
  loadOlder(): Promise<ReadonlyArray<T>>;
  readonly revealed: ReadonlyArray<T>;
  /** Newer items the listener is holding back (the "Load new" count). */
  pendingNew(): number;
  /** Reveal the withheld newer items (the sanctioned shift on explicit tap). */
  loadNew(): ReadonlyArray<T>;
  /** Observe revealed/pendingNew changes. */
  subscribe(listener: () => void): () => void;
  /** Stop the listener and cancel any pending settle. */
  close(): void;
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_SETTLE_MS = 50;

/** Default settle window: a 50ms timer (Wisp's feed conflation window). */
const defaultSchedule: Scheduler = (flush) => {
  const timer = setTimeout(flush, DEFAULT_SETTLE_MS);
  return () => clearTimeout(timer);
};

export function createSurfaceSession<T>(options: SurfaceSessionOptions<T>): SurfaceSession<T> {
  const { keyOf, fetchPage } = options;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const schedule = options.schedule ?? defaultSchedule;
  const buffer = createPageBuffer<T>({ keyOf });
  const listeners = new Set<() => void>();

  let unsubscribeLive: (() => void) | null = null;
  let cancelSettle: (() => void) | null = null;
  let pending: T[] = [];
  let closed = false;

  function notify(): void {
    for (const listener of listeners) listener();
  }

  /** Conflated flush: apply all items buffered during the settle window at once. */
  function flushPending(): void {
    cancelSettle = null;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    const before = buffer.pendingNew;
    buffer.offerNew(batch);
    if (buffer.pendingNew !== before) notify();
  }

  function onLiveItems(items: readonly T[]): void {
    if (closed || items.length === 0) return;
    pending.push(...items);
    if (!cancelSettle) cancelSettle = schedule(flushPending);
  }

  function startListener(): void {
    if (closed || !options.liveSubscribe || unsubscribeLive) return;
    unsubscribeLive = options.liveSubscribe(buffer.newestKey(), onLiveItems);
  }

  return {
    async firstPage() {
      const items = await fetchPage({ limit: pageSize });
      buffer.seed(items);
      startListener();
      notify();
      return buffer.revealed;
    },
    async loadOlder() {
      const until = buffer.oldestKey();
      if (!until) return buffer.revealed;
      const items = await fetchPage({ until, limit: pageSize });
      buffer.appendOlder(items);
      notify();
      return buffer.revealed;
    },
    get revealed() {
      return buffer.revealed;
    },
    pendingNew() {
      return buffer.pendingNew;
    },
    loadNew() {
      const revealed = buffer.revealNew();
      notify();
      return revealed;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      if (cancelSettle) cancelSettle();
      cancelSettle = null;
      if (unsubscribeLive) unsubscribeLive();
      unsubscribeLive = null;
      pending = [];
    },
  };
}
