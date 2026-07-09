/**
 * Adapters that turn coco's payment-request operations and reusable mint quotes
 * (onchain / bolt12) into one normalized `ReceiveRailItem[]` for the shared
 * "View all" screen (`ReceiveRailListScreen`).
 *
 * The three receive rails have different coco shapes but the sheet renders them
 * uniformly, so classification (reusable / awaiting / paid / cancelled /
 * expired), copy-eligibility (paid single-use surfaces must NOT be copyable —
 * a reused address/request leaks the payer relationship), and the link to the
 * resulting transaction all live here as pure, testable functions.
 *
 * "Paid" detection:
 * - payment request: coco flips a single-use request to `completed` once a
 *   claim finalizes (`active` = awaiting, `cancelled` = rotated/torn down).
 * - onchain/bolt12 quote: no state enum (they are `reusable: true`); the mint
 *   accrues `quoteData.amountPaid` as deposits land.
 *
 * Transaction link (fixed-amount paid rows): a completed single-use request's
 * child receive carries `metadata.requestOperationId === op.id`; a paid onchain
 * deposit's mint history entry carries the same `quoteId`. Both are found by
 * indexing coco history once per open.
 */

import type {
  HistoryEntry,
  Manager,
  MintQuote,
  PaymentRequestReceiveOperation,
} from '@cashu/coco-core';

import { amountToNumber, type AmountValue } from '@/shared/lib/cashu/amount';
import type { CopyTarget } from '@/shared/lib/popup/popups/copy';
import { getMintDisplayName } from '@/shared/lib/url';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import { paymentLog } from '@/shared/lib/logger';

export type ReceiveRail = 'paymentRequest' | 'onchain' | 'bolt12';

export type RailStatus =
  | 'reusable' // amountless/standing surface meant to be reused → copyable
  | 'awaiting' // single-use, not yet paid → copyable
  | 'paid' // fulfilled → NOT copyable (privacy); links to the transaction
  | 'cancelled' // torn down / rotated away → NOT copyable
  | 'expired'; // invoice/quote window elapsed → NOT copyable

export interface ReceiveRailItem {
  key: string;
  rail: ReceiveRail;
  /** The full copyable value: encoded request | address | bolt12 offer. */
  request: string;
  copyTarget: CopyTarget;
  status: RailStatus;
  /** The pinned standing request/address (renders the current-check accent). */
  isCurrent: boolean;
  mintUrl?: string;
  /** Mint label + icon resolved at build time — the sheet renders outside the
   *  Colada/Manager provider (PopupHost is app-root), so it can't call any
   *  manager-context hook (`useMintInfo`). */
  mintName?: string;
  mintIconUrl?: string;
  amount?: { value: AmountValue; unit: string };
  createdAt: number;
  /** Resolved child transaction for a paid fixed-amount row (tap → detail). */
  linkEntry?: HistoryEntry;
  /**
   * Whether coco is actively watching this reusable surface for an incoming
   * payment right now. coco exposes no public per-quote "is watched" accessor
   * (its `MintOperationWatcherService` registry is private), but its watch
   * policy is deterministic: a pending mint quote for a trusted mint is watched
   * until `shouldStopWatching` — exactly `isExpiredMintQuoteSnapshot` — so the
   * honest per-row signal is "not expired by coco's own rule" (see
   * `isExpiryElapsed`, which mirrors that gate incl. `expiry: 0` = expired).
   * Verified against runtime logs: coco sends `onchain_mint_quote` subscriptions
   * but ZERO `bolt12_mint_quote` ones, because bolt12 offers carry `expiry: 0`
   * and coco reads that as expired. Left undefined for payment requests (a
   * different, Nostr-based transport not governed by this watcher).
   */
  listening?: boolean;
}

/** Reusable/awaiting surfaces are safe to copy; settled/dead ones are not. */
export function isRailItemCopyable(status: RailStatus): boolean {
  return status === 'reusable' || status === 'awaiting';
}

export function classifyPaymentRequest(
  op: Pick<PaymentRequestReceiveOperation, 'state' | 'singleUse'>
): RailStatus {
  if (op.state === 'completed') return 'paid';
  if (op.state === 'cancelled') return 'cancelled';
  // active
  return op.singleUse ? 'awaiting' : 'reusable';
}

export function classifyOnchainQuote(amountPaid: number, isExpired: boolean): RailStatus {
  if (amountPaid > 0) return 'paid';
  if (isExpired) return 'expired';
  return 'reusable';
}

function quoteAmountPaid(quote: MintQuote): number {
  const data = quote.quoteData as { amountPaid?: unknown } | undefined;
  return data?.amountPaid != null ? amountToNumber(data.amountPaid as never) : 0;
}

/**
 * Whether an absolute-seconds `expiry` has elapsed, matching coco's own
 * `isExpiredMintQuoteSnapshot` EXACTLY — including treating `0` as expired
 * (`0 <= now`). This is deliberately coco's gate, NOT the app's reusable-QR
 * `expiry <= 0 = never-expires` convention (`wallet/src/quotes/reusable.ts`),
 * because it is precisely what coco's `MintOperationWatcherService` uses to
 * decide whether to subscribe. So it is the ground truth for "is the wallet
 * actually listening": bolt12 offers arrive with `expiry: 0` from the mint,
 * coco reads that as expired and never watches them, so the rail must show them
 * as expired / not listening to reflect reality.
 */
export function isExpiryElapsed(expiry: number | null | undefined, nowSeconds: number): boolean {
  return expiry != null && expiry <= nowSeconds;
}

function isQuoteExpired(quote: MintQuote, nowSeconds: number): boolean {
  return isExpiryElapsed(quote.expiry, nowSeconds);
}

/** Non-reactive read of the global mint-metadata cache (safe outside React /
 *  outside the manager provider) for a mint's display name + icon. */
function resolveMintDisplay(mintUrl: string): { name: string; iconUrl?: string } {
  const entry = useMintMetadataStore.getState().getCached(mintUrl);
  return {
    name: entry?.displayName || getMintDisplayName(mintUrl, null),
    iconUrl: entry?.iconUrl,
  };
}

// ---------------------------------------------------------------------------
// History index — join paid surfaces to their resulting transaction.
// ---------------------------------------------------------------------------

const HISTORY_PAGE = 200;
// A bounded walk: these lists surface recent receive activity, and an
// unbounded scan on a huge wallet would stall opening the sheet. If a very old
// completed request falls outside the window its row still renders (just
// without a tap-through), logged below.
const HISTORY_MAX_PAGES = 15;

interface HistoryLinkIndex {
  byRequestOpId: Map<string, HistoryEntry>;
  byQuoteId: Map<string, HistoryEntry>;
  truncated: boolean;
}

async function buildHistoryLinkIndex(manager: Manager): Promise<HistoryLinkIndex> {
  const byRequestOpId = new Map<string, HistoryEntry>();
  const byQuoteId = new Map<string, HistoryEntry>();
  let truncated = false;
  for (let page = 0; page < HISTORY_MAX_PAGES; page++) {
    const entries = await manager.history.getPaginatedHistory(page * HISTORY_PAGE, HISTORY_PAGE);
    for (const entry of entries) {
      if (entry.type === 'receive') {
        const reqId = (entry.metadata as Record<string, unknown> | undefined)?.requestOperationId;
        if (typeof reqId === 'string' && reqId && !byRequestOpId.has(reqId)) {
          byRequestOpId.set(reqId, entry);
        }
      } else if (entry.type === 'mint') {
        const quoteId = (entry as { quoteId?: unknown }).quoteId;
        if (typeof quoteId === 'string' && quoteId && !byQuoteId.has(quoteId)) {
          byQuoteId.set(quoteId, entry);
        }
      }
    }
    if (entries.length < HISTORY_PAGE) return { byRequestOpId, byQuoteId, truncated };
    if (page === HISTORY_MAX_PAGES - 1) truncated = true;
  }
  return { byRequestOpId, byQuoteId, truncated };
}

// ---------------------------------------------------------------------------
// Per-rail builders
// ---------------------------------------------------------------------------

export async function buildPaymentRequestItems(
  manager: Manager,
  opts: { standingId: string | undefined }
): Promise<ReceiveRailItem[]> {
  const operations = await manager.paymentRequests.incoming.list();
  const sorted = [...operations].sort((a, b) => b.createdAt - a.createdAt);
  const needsLink = sorted.some((op) => op.singleUse && op.state === 'completed');
  const index = needsLink ? await buildHistoryLinkIndex(manager) : null;
  if (index?.truncated) {
    paymentLog.warn('receive.rail_list.history_truncated', {
      rail: 'paymentRequest',
    });
  }
  return sorted.map((op) => {
    const status = classifyPaymentRequest(op);
    return {
      key: `pr-${op.id}`,
      rail: 'paymentRequest',
      request: op.encodedRequest,
      copyTarget: 'paymentRequest',
      status,
      isCurrent: op.id === opts.standingId,
      amount: op.singleUse ? { value: op.amount as never, unit: op.unit } : undefined,
      createdAt: op.createdAt,
      linkEntry: status === 'paid' ? index?.byRequestOpId.get(op.id) : undefined,
    };
  });
}

export async function buildOnchainItems(
  manager: Manager,
  opts: { standingIds: Set<string> }
): Promise<ReceiveRailItem[]> {
  const pending = (await manager.quotes.mint.listPending({
    method: 'onchain',
  })) as MintQuote[];
  const nowSeconds = Math.floor(Date.now() / 1000);
  const sorted = [...pending].sort((a, b) => b.createdAt - a.createdAt);
  const needsLink = sorted.some((q) => quoteAmountPaid(q) > 0);
  const index = needsLink ? await buildHistoryLinkIndex(manager) : null;
  if (index?.truncated) {
    paymentLog.warn('receive.rail_list.history_truncated', { rail: 'onchain' });
  }
  return sorted.map((q) => {
    const paid = quoteAmountPaid(q);
    const expired = isQuoteExpired(q, nowSeconds);
    const status = classifyOnchainQuote(paid, expired);
    const mint = resolveMintDisplay(q.mintUrl);
    return {
      key: `onchain-${q.mintUrl}-${q.quoteId}`,
      rail: 'onchain',
      request: q.request,
      copyTarget: 'address',
      status,
      isCurrent: opts.standingIds.has(q.quoteId),
      mintUrl: q.mintUrl,
      mintName: mint.name,
      mintIconUrl: mint.iconUrl,
      amount: paid > 0 ? { value: paid, unit: q.unit } : undefined,
      createdAt: q.createdAt,
      linkEntry: status === 'paid' ? index?.byQuoteId.get(q.quoteId) : undefined,
      // coco watches until expiry (see `listening` docs); a reusable onchain
      // address keeps being watched even after a deposit, so this is `!expired`
      // (not tied to paid state).
      listening: !expired,
    };
  });
}

export async function buildBolt12Items(
  manager: Manager,
  opts: { standingIds: Set<string> }
): Promise<ReceiveRailItem[]> {
  const pending = (await manager.quotes.mint.listPending({
    method: 'bolt12',
  })) as MintQuote[];
  const nowSeconds = Math.floor(Date.now() / 1000);
  const sorted = [...pending].sort((a, b) => b.createdAt - a.createdAt);
  // Bolt12 offers are one-per-mint and reusable, so no history-link scan. Status
  // follows coco's own watch gate (`isExpiryElapsed`): mints issue bolt12 offers
  // with `expiry: 0`, which coco reads as expired and never watches — so those
  // read `expired` (not listening, not copyable), matching that coco isn't
  // subscribed to them. A genuinely live offer (null/future expiry) is
  // `reusable` (copyable, "Listening").
  return sorted.map((q) => {
    const paid = quoteAmountPaid(q);
    const expired = isQuoteExpired(q, nowSeconds);
    const mint = resolveMintDisplay(q.mintUrl);
    return {
      key: `bolt12-${q.mintUrl}-${q.quoteId}`,
      rail: 'bolt12',
      request: q.request,
      copyTarget: 'bolt12Offer',
      status: expired ? 'expired' : 'reusable',
      isCurrent: opts.standingIds.has(q.quoteId),
      mintUrl: q.mintUrl,
      mintName: mint.name,
      mintIconUrl: mint.iconUrl,
      amount: paid > 0 ? { value: paid, unit: q.unit } : undefined,
      createdAt: q.createdAt,
      listening: !expired,
    };
  });
}
