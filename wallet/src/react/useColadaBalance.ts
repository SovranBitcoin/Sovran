import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BalancesByMint, Manager } from "@cashu/coco-core";

import { logger } from "../logger";
import {
  amountToNumber,
  sumReservedSends,
  type WalletBalanceBreakdown,
} from "../balance/breakdown";
import { useColadaManager } from "./ColadaProvider";
import { useLatestRef } from "./useLatestRef";

// Pending sends are recent; the first history page is enough to total them
// (matches how the app previously filtered usePaginatedHistory()).
const PENDING_PAGE_SIZE = 100;

// Colada's balance read model carries plain numbers; coco v2 BalanceSnapshot
// fields are Amount value objects and convert once at reload.
interface NumericSnapshot {
  spendable: number;
  reserved: number;
  total: number;
}

const EMPTY_SNAPSHOT: NumericSnapshot = { spendable: 0, reserved: 0, total: 0 };

/**
 * One coco read of every figure the breakdown shows, or `null` when the read
 * failed. Module scope on purpose: the React Compiler cannot lower a `try`
 * whose body contains `??`/ternaries, so leaving this inline is what made the
 * hook uncompilable. Nothing here touches React.
 */
async function readBreakdown(
  mgr: Manager,
  unit: string,
): Promise<{
  snapshot: NumericSnapshot;
  byMint: BalancesByMint;
  pending: number;
  redeeming: number;
} | null> {
  try {
    const [total, perMint, historyPage, inFlight] = await Promise.all([
      mgr.wallet.balances.total({ units: [unit] }),
      mgr.wallet.balances.byMint({ units: [unit] }),
      mgr.history.getPaginatedHistory(0, PENDING_PAGE_SIZE).catch(() => []),
      mgr.ops.receive.listInFlight().catch(() => []),
    ]);
    return {
      snapshot: {
        spendable: amountToNumber(total.spendable),
        reserved: amountToNumber(total.reserved),
        total: amountToNumber(total.total),
      },
      byMint: perMint,
      pending: sumReservedSends(
        (historyPage ?? []).filter((entry) => (entry.unit ?? "sat") === unit),
      ),
      redeeming: inFlight
        .filter((op) => (op.unit ?? "sat") === unit)
        .reduce((sum, op) => sum + amountToNumber(op.amount), 0),
    };
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
 * existing callers keep today's behavior).
 */
export function useColadaBalance(unit = "sat"): WalletBalanceBreakdown {
  const manager = useColadaManager();

  const [snapshot, setSnapshot] = useState<NumericSnapshot>(EMPTY_SNAPSHOT);
  const [byMint, setByMint] = useState<BalancesByMint>({});
  const [pending, setPending] = useState(0);
  const [redeeming, setRedeeming] = useState(0);

  const mountedRef = useRef(true);
  // Written in useInsertionEffect rather than in render: a ref write in the
  // render body switches the React Compiler off for this whole hook. Every
  // read is from `reload`, which only ever runs from an effect or a coco
  // event, so it still observes the same manager the render committed.
  const managerRef = useLatestRef(manager);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The dep list names the ref too. It used to read `[unit]` while the body
  // also reached `managerRef`, and a memo the compiler cannot preserve
  // switches the compiler off for the whole hook. Keeping an explicit
  // useCallback (rather than letting the compiler infer one) matters here:
  // the effect below depends on `reload`, so an identity that churned every
  // render would re-enter it every render — a balance-reload loop against the
  // mint in any environment where the compiler is not running, Jest included.
  const reload = useCallback(async () => {
    // Pin the manager this read belongs to. A profile switch swaps the manager
    // while a read is in flight — the outgoing manager's event subscription is
    // still attached until its cleanup runs — and without this the slower of
    // the two reads wins, which can paint the PREVIOUS profile's balance over
    // the current one.
    const mgr = managerRef.current;
    const next = await readBreakdown(mgr, unit);
    if (!next || !mountedRef.current || managerRef.current !== mgr) return;
    setSnapshot(next.snapshot);
    setByMint(next.byMint);
    setPending(next.pending);
    setRedeeming(next.redeeming);
    logger.debug("balance.breakdown.reload", {
      unit,
      mintCount: Object.keys(next.byMint).length,
    });
  }, [unit, managerRef]);

  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  // Initial load + reload when the manager identity changes (profile switch).
  useEffect(() => {
    void reload();
  }, [manager, reload]);

  // Recompute on the events that move any figure: proof movement (balance +
  // reserved + pending + redeeming), mint changes, and history projection.
  useEffect(() => {
    const onChange = () => void reloadRef.current();
    const events = [
      "proofs:saved",
      "proofs:state-changed",
      "proofs:reserved",
      "proofs:released",
      "mint:updated",
      "history:updated",
      "receive-op:prepared",
      "receive-op:finalized",
      "receive-op:rolled-back",
    ] as const;
    for (const event of events) manager.on(event, onChange);
    return () => {
      for (const event of events) manager.off(event, onChange);
    };
  }, [manager]);

  return useMemo(
    () => ({
      spendable: snapshot.spendable,
      reserved: snapshot.reserved,
      total: snapshot.total,
      pending,
      redeeming,
      byMint,
    }),
    [snapshot, pending, redeeming, byMint],
  );
}
