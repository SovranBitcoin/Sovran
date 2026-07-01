import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BalancesByMint, BalanceSnapshot, Manager } from "@cashu/coco-core";

import { logger } from "../logger";
import {
  amountToNumber,
  sumReservedSends,
  type WalletBalanceBreakdown,
} from "../balance/breakdown";
import { useColadaManager } from "./ColadaProvider";

// Pending sends are recent; the first history page is enough to total them
// (matches how the app previously filtered usePaginatedHistory()).
const PENDING_PAGE_SIZE = 100;

const EMPTY_SNAPSHOT: BalanceSnapshot = { spendable: 0, reserved: 0, total: 0 };

/**
 * The wallet balance breakdown: spendable / reserved / total from coco's
 * balance API, plus pending (cancellable ecash sends) and redeeming
 * (received-but-unredeemed ecash). React binding over the framework-agnostic
 * helpers in `balance/breakdown`, reaching coco via the `useColadaManager` seam.
 */
export function useColadaBalance(): WalletBalanceBreakdown {
  const manager = useColadaManager();

  const [snapshot, setSnapshot] = useState<BalanceSnapshot>(EMPTY_SNAPSHOT);
  const [byMint, setByMint] = useState<BalancesByMint>({});
  const [pending, setPending] = useState(0);
  const [redeeming, setRedeeming] = useState(0);

  const mountedRef = useRef(true);
  const managerRef = useRef<Manager>(manager);
  managerRef.current = manager;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const mgr = managerRef.current;
    try {
      const [total, perMint, historyPage, inFlight] = await Promise.all([
        mgr.wallet.balances.total(),
        mgr.wallet.balances.byMint(),
        mgr.history.getPaginatedHistory(0, PENDING_PAGE_SIZE).catch(() => []),
        mgr.ops.receive.listInFlight().catch(() => []),
      ]);
      if (!mountedRef.current) return;
      setSnapshot(total);
      setByMint(perMint);
      setPending(sumReservedSends(historyPage ?? []));
      setRedeeming(inFlight.reduce((sum, op) => sum + amountToNumber(op.amount), 0));
    } catch (err) {
      logger.warn("balance.breakdown.reload_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

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
