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

import { isQuoteExpiryElapsed } from 'wallet';
import type {
  HistoryEntry,
  Manager,
  MintQuote,
  PaymentRequestReceiveOperation,
} from '@cashu/coco-core';

import { amountToNumber, type AmountValue } from 'wallet/amount';
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
  | 'expired' // invoice/quote window elapsed → NOT copyable
  | 'inactive'; // its mint is no longer trusted, so Coco stops watching it → NOT copyable

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
   * Whether this reusable surface is still live for an incoming payment.
   * Coco (58abfae) watches a pending mint quote only while its mint is
   * trusted, with no expiry gate (`MintOperationWatcherService` skips
   * untrusted mints on start and drops their subscriptions on untrust), so the
   * per-row signal is "mint trusted and not expired" by `isExpiryElapsed`
   * (where `expiry: 0` means no expiry). Left
   * undefined for payment requests (a different, Nostr-based transport not
   * governed by this watcher).
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

export function classifyOnchainQuote(
  amountPaid: number,
  isExpired: boolean,
  mintTrusted = true
): RailStatus {
  if (amountPaid > 0) return 'paid';
  if (isExpired) return 'expired';
  return mintTrusted ? 'reusable' : 'inactive';
}

/**
 * Which of these quotes' mints are trusted right now. Coco lists an untrusted
 * mint's pending quotes but does not watch them, so a payment to one would not
 * be credited until recovered.
 */
async function trustedMintsOf(manager: Manager, quotes: MintQuote[]): Promise<Set<string>> {
  const urls = [...new Set(quotes.map((q) => q.mintUrl))];
  const trusted = await Promise.all(urls.map((url) => manager.mint.isTrustedMint(url)));
  return new Set(urls.filter((_, i) => trusted[i]));
}

function quoteAmountPaid(quote: MintQuote): number {
  const data = quote.quoteData as { amountPaid?: unknown } | undefined;
  return data?.amountPaid != null ? amountToNumber(data.amountPaid as never) : 0;
}

/**
 * Whether an absolute-seconds `expiry` has elapsed. `expiry: 0` (how mints
 * send bolt12 offers) and null mean "no expiry": the wallet keeps such an
 * offer as the standing one, and Coco keeps watching a pending quote whatever
 * its expiry.
 */
export function isExpiryElapsed(expiry: number | null | undefined, nowSeconds: number): boolean {
  return isQuoteExpiryElapsed(expiry, nowSeconds);
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

/**
 * The row fields every mint-quote rail carries whatever its method: which mint
 * issued the quote and how it is labelled, how much has landed on it so far,
 * and whether it is the surface the Receive screen is currently standing on.
 * Only `status`, `copyTarget` and the method-specific extras differ per rail.
 */
function mintQuoteRailFields(
  quote: MintQuote,
  standingIds: Set<string>
): Pick<
  ReceiveRailItem,
  'isCurrent' | 'mintUrl' | 'mintName' | 'mintIconUrl' | 'amount' | 'createdAt'
> {
  const mint = resolveMintDisplay(quote.mintUrl);
  const paid = quoteAmountPaid(quote);
  return {
    isCurrent: standingIds.has(quote.quoteId),
    mintUrl: quote.mintUrl,
    mintName: mint.name,
    mintIconUrl: mint.iconUrl,
    amount: paid > 0 ? { value: paid, unit: quote.unit } : undefined,
    createdAt: quote.createdAt,
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

function quoteLinkKey(mintUrl: string, quoteId: string): string {
  return JSON.stringify([mintUrl, quoteId]);
}

async function buildHistoryLinkIndex(
  manager: Manager,
  targets: { requestOpIds?: string[]; quoteKeys?: string[] }
): Promise<HistoryLinkIndex> {
  const byRequestOpId = new Map<string, HistoryEntry>();
  const byQuoteId = new Map<string, HistoryEntry>();
  const missingRequests = new Set(targets.requestOpIds);
  const missingQuotes = new Set(targets.quoteKeys);
  let truncated = false;
  for (let page = 0; page < HISTORY_MAX_PAGES; page++) {
    const entries = await manager.history.getPaginatedHistory(page * HISTORY_PAGE, HISTORY_PAGE);
    for (const entry of entries) {
      if (entry.type === 'receive') {
        const reqId = (entry.metadata as Record<string, unknown> | undefined)?.requestOperationId;
        if (typeof reqId === 'string' && missingRequests.delete(reqId)) {
          byRequestOpId.set(reqId, entry);
        }
      } else if (entry.type === 'mint') {
        const key = quoteLinkKey(entry.mintUrl, entry.quoteId);
        if (missingQuotes.delete(key)) {
          byQuoteId.set(key, entry);
        }
      }
    }
    // Pages are newest first, so the first match is authoritative for each
    // link. Once every visible paid row is linked, older pages add no value.
    if (missingRequests.size === 0 && missingQuotes.size === 0)
      return { byRequestOpId, byQuoteId, truncated };
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
  const index = needsLink
    ? await buildHistoryLinkIndex(manager, {
        requestOpIds: sorted
          .filter((op) => op.singleUse && op.state === 'completed')
          .map((op) => op.id),
      })
    : null;
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
  const trusted = await trustedMintsOf(manager, sorted);
  const needsLink = sorted.some((q) => quoteAmountPaid(q) > 0);
  const index = needsLink
    ? await buildHistoryLinkIndex(manager, {
        quoteKeys: sorted
          .filter((q) => quoteAmountPaid(q) > 0)
          .map((q) => quoteLinkKey(q.mintUrl, q.quoteId)),
      })
    : null;
  if (index?.truncated) {
    paymentLog.warn('receive.rail_list.history_truncated', { rail: 'onchain' });
  }
  return sorted.map((q) => {
    const expired = isQuoteExpired(q, nowSeconds);
    const mintTrusted = trusted.has(q.mintUrl);
    const status = classifyOnchainQuote(quoteAmountPaid(q), expired, mintTrusted);
    return {
      key: `onchain-${q.mintUrl}-${q.quoteId}`,
      rail: 'onchain',
      request: q.request,
      copyTarget: 'address',
      status,
      ...mintQuoteRailFields(q, opts.standingIds),
      linkEntry:
        status === 'paid' ? index?.byQuoteId.get(quoteLinkKey(q.mintUrl, q.quoteId)) : undefined,
      // coco watches a trusted mint's quote until expiry (see `listening`
      // docs); a reusable onchain address keeps being watched even after a
      // deposit, so this is not tied to paid state.
      listening: mintTrusted && !expired,
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
  const trusted = await trustedMintsOf(manager, sorted);
  // Bolt12 offers are one-per-mint and reusable, so no history-link scan. An
  // offer with no expiry (null or `0`, how mints send them) or a future one is
  // `reusable` (copyable, "Listening") while its mint is trusted; a past expiry
  // reads `expired`, an untrusted mint's offer `inactive`.
  return sorted.map((q) => {
    const expired = isQuoteExpired(q, nowSeconds);
    const mintTrusted = trusted.has(q.mintUrl);
    return {
      key: `bolt12-${q.mintUrl}-${q.quoteId}`,
      rail: 'bolt12',
      request: q.request,
      copyTarget: 'bolt12Offer',
      status: expired ? 'expired' : mintTrusted ? 'reusable' : 'inactive',
      ...mintQuoteRailFields(q, opts.standingIds),
      listening: mintTrusted && !expired,
    };
  });
}
