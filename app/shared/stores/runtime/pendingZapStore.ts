/**
 * Pending-zap registry — plain module state, never persisted.
 *
 * Bridges the gap between "the user tapped a zap preset on a post" and the
 * moment the wallet's melt pipeline fetches the LNURL invoice: the Colada
 * provider's `getLnurlPayExtras` callback looks the melt target up here to
 * decide whether to attach a signed kind-9734 zap request, and the
 * annotation writers look it up to stamp the post facts onto the melt's
 * transaction annotation.
 *
 * Keyed by the normalized (lowercased) melt target. Entries are evicted by
 * `clearPaymentContext` (every payment root calls it), consumed on
 * completion, and TTL-bounded so an abandoned zap can never decorate an
 * unrelated later payment to the same lightning address.
 */

import { storeLog } from '@/shared/lib/logger';
import type { ZapReceiptKind } from 'wallet';

export interface PendingZap {
  /** Normalized (lowercased) lightning address / lnurlp melt target. */
  meltTarget: string;
  /** Zapped post's nostr event id (hex). */
  eventId: string;
  /** Zapped post's kind (9734 `k` tag). */
  eventKind: number;
  /** Post author's nostr pubkey (hex). */
  authorPubkey: string;
  authorName?: string;
  authorAvatarUrl?: string;
  /** Short display snapshot of the post content (~120 chars). */
  contentPreview: string;
  /** Preset emoji ('⚡' for the custom-amount path). */
  emoji: string;
  /** Zap comment (9734 content). Empty string = no comment. */
  comment: string;
  /** Preset sats; undefined for the custom-amount path. */
  presetSats?: number;
  /** The post's satsZapped at menu-tap time — seeds the optimistic entry's
   *  expectedSats when the melt confirms. */
  baseSats?: number;
  createdAt: number;
  /** Stamped by the Colada getLnurlPayExtras callback during invoice fetch. */
  receiptKind?: ZapReceiptKind;
}

const TTL_MS = 15 * 60_000;

const pendingByTarget = new Map<string, PendingZap>();

function normalizeTarget(meltTarget: string): string {
  return meltTarget.trim().toLowerCase();
}

export function registerPendingZap(zap: PendingZap): void {
  const key = normalizeTarget(zap.meltTarget);
  pendingByTarget.set(key, { ...zap, meltTarget: key });
  storeLog.info('zap.pending.register', {
    eventIdPrefix: zap.eventId.slice(0, 8),
    presetSats: zap.presetSats ?? null,
    hasComment: zap.comment.length > 0,
  });
}

/** TTL-checked lookup; expired entries are dropped on read. */
export function peekPendingZap(meltTarget: string): PendingZap | undefined {
  const key = normalizeTarget(meltTarget);
  const pending = pendingByTarget.get(key);
  if (!pending) return undefined;
  if (Date.now() - pending.createdAt > TTL_MS) {
    pendingByTarget.delete(key);
    storeLog.info('zap.pending.expired', {
      eventIdPrefix: pending.eventId.slice(0, 8),
    });
    return undefined;
  }
  return pending;
}

/** Record whether the invoice fetch attached a real 9734 or fell back to plain. */
export function markPendingZapReceipt(meltTarget: string, kind: ZapReceiptKind): void {
  const pending = peekPendingZap(meltTarget);
  if (!pending) return;
  pending.receiptKind = kind;
}

export function consumePendingZap(meltTarget: string): void {
  pendingByTarget.delete(normalizeTarget(meltTarget));
}

/** Root-entry eviction — called from clearPaymentContext. */
export function clearPendingZaps(): void {
  if (pendingByTarget.size > 0) {
    storeLog.info('zap.pending.cleared', { count: pendingByTarget.size });
  }
  pendingByTarget.clear();
}
