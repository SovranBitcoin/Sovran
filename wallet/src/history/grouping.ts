// ---------------------------------------------------------------------------
// Grouped transaction timeline (framework-agnostic)
// ---------------------------------------------------------------------------
//
// A wallet "swap" (rebalance) is two coco history entries — a melt leg on the
// source mint and a mint leg on the destination — that should render as ONE
// row. Today the app re-derives this grouping from a side store and hides the
// child legs inline. Once each leg carries a `swap` annotation (`swapGroupId` +
// `role`), colada can collapse them here so consumers get an already-grouped
// timeline and stop building synthetic rows themselves.

import type { HistoryEntry } from "@cashu/coco-core";

import { amountToNumber } from "../amount";
import { getSwap } from "../annotations/selectors";
import {
  bucketTransaction,
  isSendTokenCancelled,
  isSettledReceiveHistoryEntry,
  isSettledSpendHistoryEntry,
  type TransactionBucket,
} from "./filters";

export type SwapTimelineState = "running" | "finished" | "cancelled";

export type ColadaTimelineItem =
  | {
      kind: "entry";
      entry: HistoryEntry;
      bucket: TransactionBucket;
      createdAt: number;
    }
  | {
      kind: "swap";
      groupId: string;
      legs: HistoryEntry[];
      state: SwapTimelineState;
      bucket: TransactionBucket;
      amount: number;
      unit: string;
      createdAt: number;
      chainPath?: string[];
    };

function legHopIndex(entry: HistoryEntry): number {
  return getSwap(entry)?.hopIndex ?? 0;
}

/**
 * Derive a swap's display state from its legs:
 *  - any leg still pending → `running`
 *  - else any leg cancelled/rolled-back and nothing settled → `cancelled`
 *  - else → `finished`
 */
function deriveSwapState(legs: readonly HistoryEntry[]): SwapTimelineState {
  let anyPending = false;
  let anyCancelled = false;
  let anySettled = false;
  for (const leg of legs) {
    if (bucketTransaction(leg) === "pending") anyPending = true;
    if (isSendTokenCancelled(leg)) anyCancelled = true;
    if (isSettledSpendHistoryEntry(leg) || isSettledReceiveHistoryEntry(leg)) {
      anySettled = true;
    }
  }
  if (anyPending) return "running";
  if (anyCancelled && !anySettled) return "cancelled";
  return "finished";
}

const SWAP_STATE_TO_BUCKET: Record<SwapTimelineState, TransactionBucket> = {
  running: "pending",
  finished: "confirmed",
  cancelled: "expired",
};

function buildSwapItem(
  groupId: string,
  unsorted: HistoryEntry[],
): ColadaTimelineItem {
  const legs = [...unsorted].sort((a, b) => legHopIndex(a) - legHopIndex(b));
  const state = deriveSwapState(legs);

  // Representative amount: the destination (mint-role) leg if present, else the
  // largest leg — both legs of a single hop carry ~the same amount.
  const mintLeg = legs.find((leg) => getSwap(leg)?.role === "mint");
  // Amounts on live coco v2 entries are Amount value objects; the swap-group
  // read model carries plain numbers.
  const amount = mintLeg
    ? amountToNumber(mintLeg.amount)
    : legs.reduce((max, leg) => Math.max(max, amountToNumber(leg.amount ?? 0)), 0);

  const unit = legs.find((leg) => leg.unit)?.unit ?? "sat";
  // Sort the group by its most recent leg so it ranks by latest activity.
  const createdAt = legs.reduce((max, leg) => Math.max(max, leg.createdAt), 0);

  const chainId = getSwap(legs[0])?.chainId;
  const chainPath = chainId
    ? legs.reduce<string[]>((path, leg) => {
        if (leg.mintUrl && path[path.length - 1] !== leg.mintUrl)
          path.push(leg.mintUrl);
        return path;
      }, [])
    : undefined;

  return {
    kind: "swap",
    groupId,
    legs,
    state,
    bucket: SWAP_STATE_TO_BUCKET[state],
    amount,
    unit,
    createdAt,
    ...(chainPath && chainPath.length > 0 ? { chainPath } : {}),
  };
}

/**
 * Collapse entries sharing a `swapGroupId` into one swap item, leaving every
 * other entry as a plain `entry` item. Input order is preserved (a swap appears
 * where its first leg appeared); callers that need newest-first should sort by
 * `createdAt` after grouping.
 */
export function groupTimeline(
  entries: readonly HistoryEntry[],
  options: { isCollapsingGhost?: (entry: HistoryEntry) => boolean } = {},
): ColadaTimelineItem[] {
  const legsByGroup = new Map<string, HistoryEntry[]>();
  for (const entry of entries) {
    const groupId = getSwap(entry)?.groupId;
    if (groupId) {
      const legs = legsByGroup.get(groupId);
      if (legs) legs.push(entry);
      else legsByGroup.set(groupId, [entry]);
    }
  }

  const placedGroups = new Set<string>();
  const items: ColadaTimelineItem[] = [];
  for (const entry of entries) {
    const groupId = getSwap(entry)?.groupId;
    if (groupId) {
      if (placedGroups.has(groupId)) continue;
      placedGroups.add(groupId);
      items.push(buildSwapItem(groupId, legsByGroup.get(groupId) ?? [entry]));
      continue;
    }
    items.push({
      kind: "entry",
      entry,
      bucket: bucketTransaction(entry, {
        isCollapsingGhost: options.isCollapsingGhost?.(entry),
      }),
      createdAt: entry.createdAt,
    });
  }
  return items;
}
