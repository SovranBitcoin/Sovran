import { useEffect, useMemo, useState } from "react";
import { Amount, type Manager } from "@cashu/coco-core";

import { logger } from "../logger";
import {
  amountToNumber,
  emptyBalanceBreakdown,
  sumReservedSends,
  type WalletBalanceBreakdown,
} from "../balance/breakdown";
import { useColadaManager } from "./ColadaProvider";

// Pending sends are recent; the first history page is enough to total them
// (matches how the app previously filtered usePaginatedHistory()).
const PENDING_PAGE_SIZE = 100;

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
): Promise<WalletBalanceBreakdown | null> {
  try {
    const [perMint, historyPage, inFlight] = await Promise.all([
      mgr.wallet.balances.byMint({ units: [unit] }),
      mgr.history.getPaginatedHistory(0, PENDING_PAGE_SIZE).catch(() => []),
      mgr.ops.receive.listInFlight().catch(() => []),
    ]);
    // Coco's total() reads byMint() again. Aggregate this one snapshot with
    // Amount arithmetic, matching Coco without a second scan of ready proofs.
    let spendable = Amount.zero();
    let reserved = Amount.zero();
    let total = Amount.zero();
    const included = (mintUrl: unknown) =>
      !includeMint || typeof mintUrl !== "string" || includeMint(mintUrl);
    for (const [mintUrl, balance] of Object.entries(perMint)) {
      if (!included(mintUrl)) {
        delete perMint[mintUrl];
        continue;
      }
      spendable = spendable.add(balance.spendable);
      reserved = reserved.add(balance.reserved);
      total = total.add(balance.total);
    }
    return {
      spendable: amountToNumber(spendable),
      reserved: amountToNumber(reserved),
      total: amountToNumber(total),
      byMint: perMint,
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
 * existing callers keep today's behavior). `includeMint` narrows them to one
 * side of the testnut split (see account-units) — pass a referentially stable
 * predicate, it re-scopes the read.
 */
export function useColadaBalance(
  unit = "sat",
  includeMint?: (mintUrl: string) => boolean,
): WalletBalanceBreakdown {
  const manager = useColadaManager();

  const [snapshot, setSnapshot] = useState(() => ({
    manager,
    unit,
    includeMint,
    balance: emptyBalanceBreakdown(),
  }));
  const balance = useMemo(
    () =>
      snapshot.manager === manager &&
      snapshot.unit === unit &&
      snapshot.includeMint === includeMint
        ? snapshot.balance
        : emptyBalanceBreakdown(),
    [snapshot, manager, unit, includeMint],
  );

  useEffect(() => {
    // Scope the queue to this manager and unit. Cleanup invalidates both the
    // current read and any trailing refresh before a new scope starts reading.
    let cancelled = false;
    let running = false;
    let requested = false;
    const reload = async () => {
      requested = true;
      if (running) return;
      running = true;
      while (requested && !cancelled) {
        requested = false;
        const next = await readBreakdown(manager, unit, includeMint);
        // Events received during a read invalidate it. Collapse their work
        // into one trailing read, and never paint the outdated snapshot.
        if (next && !requested && !cancelled) {
          setSnapshot({ manager, unit, includeMint, balance: next });
          logger.debug("balance.breakdown.reload", {
            unit,
            mintCount: Object.keys(next.byMint).length,
          });
        }
      }
      running = false;
    };
    const onChange = () => void reload();
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
    void reload();
    return () => {
      cancelled = true;
      for (const event of events) manager.off(event, onChange);
    };
  }, [manager, unit, includeMint]);

  return balance;
}
