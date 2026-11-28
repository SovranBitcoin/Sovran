import { useSyncExternalStore } from "react";
import { Amount, type Manager } from "@cashu/coco-core";

import { logger } from "../logger";
import { amountToNumber } from "../amount";
import {
  emptyBalanceBreakdown,
  sumReservedSends,
  type WalletBalanceBreakdown,
} from "../balance/breakdown";
import { useColadaManager } from "./ColadaProvider";
import { createSharedReadStore, type SharedReadStore } from "./sharedReadStore";

// Pending sends are recent; the first history page is enough to total them
// (matches how the app previously filtered usePaginatedHistory()).
const PENDING_PAGE_SIZE = 100;

// The three coco reads behind a breakdown: per-mint balances, the history
// page (pending sends) and in-flight receives.
type Reads = [
  Awaited<ReturnType<Manager["wallet"]["balances"]["byMint"]>>,
  Awaited<ReturnType<Manager["history"]["getPaginatedHistory"]>>,
  Awaited<ReturnType<Manager["ops"]["receive"]["listInFlight"]>>,
];
type Read = 0 | 1 | 2;

// Which reads each event can change. Balances move only with proofs or a
// mint. Pending sends come from history, which coco re-projects on every send
// transition, and which reserve, release or spend proofs. In-flight receives
// are listed again on every event: a receive starts executing without one.
const EVENT_READS: Record<string, readonly Read[]> = {
  "proofs:saved": [0, 2],
  "proofs:state-changed": [0, 1, 2],
  "proofs:reserved": [0, 1, 2],
  "proofs:released": [0, 1, 2],
  "mint:updated": [0, 2],
  "history:updated": [1, 2],
  "receive-op:prepared": [2],
  "receive-op:finalized": [0, 2],
  "receive-op:rolled-back": [0, 2],
};

/** Same figures and per-mint amounts: consumers may keep the old object. */
function sameBreakdown(a: WalletBalanceBreakdown, b: WalletBalanceBreakdown): boolean {
  const keys = ["spendable", "reserved", "total", "pending", "redeeming"] as const;
  if (keys.some((key) => a[key] !== b[key])) return false;
  const mints = Object.keys(b.byMint);
  return mints.length === Object.keys(a.byMint).length && mints.every((url) => {
    const [x, y] = [a.byMint[url], b.byMint[url]];
    return !!x && x.spendable.equals(y.spendable) && x.reserved.equals(y.reserved) &&
      x.total.equals(y.total) && Object.keys(x).length === Object.keys(y).length;
  });
}

/**
 * One coco read of every figure the breakdown shows, or `null` when the read
 * failed. Module scope on purpose: the React Compiler cannot lower a `try`
 * whose body contains `??`/ternaries, so leaving this inline is what made the
 * hook uncompilable. Nothing here touches React.
 */
async function readBreakdown(
  mgr: Manager,
  unit: string,
  includeMint: ((mintUrl: string) => boolean) | undefined,
  dirty: ReadonlySet<Read>,
  last: Reads | null,
): Promise<{ reads: Reads; breakdown: WalletBalanceBreakdown } | null> {
  const stale = (read: Read) => !last || dirty.has(read);
  try {
    const [perMint, historyPage, inFlight] = await Promise.all([
      stale(0) ? mgr.wallet.balances.byMint({ units: [unit] }) : last![0],
      stale(1) ? mgr.history.getPaginatedHistory(0, PENDING_PAGE_SIZE).catch(() => []) : last![1],
      stale(2) ? mgr.ops.receive.listInFlight().catch(() => []) : last![2],
    ]);
    const reads: Reads = [perMint, historyPage, inFlight];
    // Coco's total() reads byMint() again. Aggregate this one snapshot with
    // Amount arithmetic, matching Coco without a second scan of ready proofs.
    let spendable = Amount.zero();
    let reserved = Amount.zero();
    let total = Amount.zero();
    const included = (mintUrl: unknown) =>
      !includeMint || typeof mintUrl !== "string" || includeMint(mintUrl);
    // Coco owns the object it returned; the narrowed view is a copy.
    const byMint: typeof perMint = {};
    for (const [mintUrl, balance] of Object.entries(perMint)) {
      if (!included(mintUrl)) continue;
      byMint[mintUrl] = balance;
      spendable = spendable.add(balance.spendable);
      reserved = reserved.add(balance.reserved);
      total = total.add(balance.total);
    }
    return { reads, breakdown: {
      spendable: amountToNumber(spendable),
      reserved: amountToNumber(reserved),
      total: amountToNumber(total),
      byMint,
      pending: sumReservedSends(
        (historyPage ?? []).filter(
          (entry) =>
            (entry.unit ?? "sat") === unit &&
            included((entry as { mintUrl?: unknown }).mintUrl),
        ),
      ),
      redeeming: inFlight
        .filter(
          (op) =>
            (op.unit ?? "sat") === unit &&
            included((op as { mintUrl?: unknown }).mintUrl),
        )
        .reduce((sum, op) => sum + amountToNumber(op.amount), 0),
    } };
  } catch (err) {
    logger.warn("balance.breakdown.reload_failed", {
      unit,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * The wallet balance breakdown: spendable / reserved / total from coco's
 * balance API, plus pending (cancellable ecash sends) and redeeming
 * (received-but-unredeemed ecash). React binding over the framework-agnostic
 * helpers in `balance/breakdown`, reaching coco via the `useColadaManager` seam.
 *
 * All figures are scoped to `unit` (coco v2 multi-unit; defaults to sat so
 * existing callers keep today's behavior). `includeMint` narrows them to one
 * side of the testnut split (see units/accounts) — pass a referentially stable
 * predicate, it re-scopes the read.
 */
export function useColadaBalance(
  unit = "sat",
  includeMint?: (mintUrl: string) => boolean,
): WalletBalanceBreakdown {
  const manager = useColadaManager();

  const store = balanceStore(manager, unit, includeMint);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

// Predicate keys are weak too: a retired caller's predicate must not stay
// alive for the manager's lifetime. Inactive stores retain only an empty value.
const balances = new WeakMap<Manager, Map<string, {
  all: SharedReadStore<WalletBalanceBreakdown>;
  filtered: WeakMap<(mintUrl: string) => boolean, SharedReadStore<WalletBalanceBreakdown>>;
}>>();

function balanceStore(
  manager: Manager,
  unit: string,
  includeMint?: (mintUrl: string) => boolean,
): SharedReadStore<WalletBalanceBreakdown> {
  let units = balances.get(manager);
  if (!units) {
    units = new Map();
    balances.set(manager, units);
  }
  let scope = units.get(unit);
  if (!scope) {
    scope = { all: createBalanceStore(manager, unit), filtered: new WeakMap() };
    units.set(unit, scope);
  }
  if (!includeMint) return scope.all;
  let store = scope.filtered.get(includeMint);
  if (!store) {
    store = createBalanceStore(manager, unit, includeMint);
    scope.filtered.set(includeMint, store);
  }
  return store;
}

function createBalanceStore(
  manager: Manager,
  unit: string,
  includeMint?: (mintUrl: string) => boolean,
): SharedReadStore<WalletBalanceBreakdown> {
  return createSharedReadStore(emptyBalanceBreakdown, (publish) => {
    // A subscription lifetime owns its reads, their trailing refresh and the
    // last reads and value it published.
    let cancelled = false;
    let running = false;
    let scheduled = false;
    let reads: Reads | null = null;
    let published: WalletBalanceBreakdown | null = null;
    const dirty = new Set<Read>([0, 1, 2]);
    const reload = async () => {
      if (running) return;
      running = true;
      while (dirty.size > 0 && !cancelled) {
        const reading = new Set(dirty);
        dirty.clear();
        const next = await readBreakdown(manager, unit, includeMint, reading, reads);
        if (!next) {
          for (const read of reading) dirty.add(read);
          break;
        }
        // Events received during a read invalidate the parts they name.
        // Collapse their work into one trailing read (reusing the other
        // parts), and never paint the outdated snapshot.
        reads = next.reads;
        if (dirty.size > 0 || cancelled) continue;
        if (published && sameBreakdown(published, next.breakdown)) continue;
        published = next.breakdown;
        publish(next.breakdown);
        logger.debug("balance.breakdown.reload", {
          unit,
          mintCount: Object.keys(next.breakdown.byMint).length,
        });
      }
      running = false;
    };
    // One coco change emits several events in the same turn: read once.
    const handlers = Object.entries(EVENT_READS).map(([event, reads]) => {
      const handler = () => {
        for (const read of reads) dirty.add(read);
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          void reload();
        });
      };
      return [event as "proofs:saved", handler] as const;
    });
    for (const [event, handler] of handlers) manager.on(event, handler);
    void reload();
    return () => {
      cancelled = true;
      for (const [event, handler] of handlers) manager.off(event, handler);
    };
  });
}
