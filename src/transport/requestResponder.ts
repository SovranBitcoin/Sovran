// ---------------------------------------------------------------------------
// Mesh transport — payment-request responder (receiver side)
//
// Answers inbound solicits with a real single-use NUT-18 payment request:
// fresh `i` (correlation id), our trusted-mints allowlist as `m` (kills
// untrusted-mint parking BEFORE money moves), `nut10` with the profile's
// P2PK receive key unless the sender flagged an offline (bearer) send, and
// no transport — per NUT-18, an empty transport means the payment comes back
// in-band (here: the mesh 0xA2 payload).
//
// Issued requests are tracked so `validateInboundMeshPayment` can enforce
// id-match, mint-allowlist, lock-match, expiry, and single-use.
// ---------------------------------------------------------------------------

import { PaymentRequest } from '@cashu/cashu-ts';
import { logger } from '../logger';
import { normalizeMintUrl } from './plan';
import type { MeshTransportAdapter } from './types';

const DEFAULT_REQUEST_TTL_MS = 120_000;
const P2PK_RECEIVE_KEY_PATTERN = /^02[0-9a-f]{64}$/i;

export interface IssuedMeshRequest {
  paymentId: string;
  peerId: string;
  creq: string;
  /** Normalized trusted-mint allowlist baked into the request. */
  mintUrls: string[];
  /** "02" + x-only hex, or null for a bearer (sender-offline) request. */
  lockPubkey: string | null;
  unit: string;
  issuedAt: number;
  expiresAt: number;
  /** Single-use: flipped by `consume` when a payment claims the request. */
  consumed: boolean;
}

export interface MeshRequestResponderConfig {
  adapter: MeshTransportAdapter;
  /** The profile's P2PK receive key ("02" + x-only hex); null disables locked requests. */
  getP2pkReceiveKey: () => string | null;
  /** Trusted-mint allowlist for `m`. Empty list = accept any mint (NUT-18). */
  getTrustedMintUrls: () => Promise<string[]>;
  unit?: string;
  requestTtlMs?: number;
  now?: () => number;
}

export interface MeshRequestResponder {
  /** Subscribe to the adapter and start answering solicits. Returns stop(). */
  start(): () => void;
  /** Look up a live (unexpired, unconsumed) issued request by payment id. */
  getOutstanding(paymentId: string): IssuedMeshRequest | null;
  /**
   * Like `getOutstanding` but returns consumed requests too — lets payment
   * validation tell a duplicate delivery apart from an id we never issued.
   */
  peek(paymentId: string): IssuedMeshRequest | null;
  /** Claim a live request (single-use). Null if unknown/expired/already consumed. */
  consume(paymentId: string): IssuedMeshRequest | null;
  /** Drop all issued requests (profile switch / shutdown). */
  clear(): void;
}

function randomPaymentId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

export function createMeshRequestResponder(
  config: MeshRequestResponderConfig
): MeshRequestResponder {
  const ttlMs = config.requestTtlMs ?? DEFAULT_REQUEST_TTL_MS;
  const now = config.now ?? Date.now;
  const unit = config.unit ?? 'sat';
  const issued = new Map<string, IssuedMeshRequest>();

  function pruneExpired(): void {
    const cutoff = now();
    for (const [paymentId, request] of issued) {
      if (request.expiresAt <= cutoff) issued.delete(paymentId);
    }
  }

  async function answerSolicit(
    peerId: string,
    solicitId: string,
    senderOffline: boolean
  ): Promise<void> {
    const lockPubkey = senderOffline ? null : config.getP2pkReceiveKey();
    if (!senderOffline && !P2PK_RECEIVE_KEY_PATTERN.test(lockPubkey ?? '')) {
      // No usable lock key for an online (locked) solicit: stay silent. The
      // sender's solicit timeout reads as "couldn't confirm receiver" — never
      // hand out a bearer request the sender didn't ask for.
      logger.warn('transport.responder.noReceiveKey', { peerId });
      return;
    }

    const mintUrls = (await config.getTrustedMintUrls()).map(normalizeMintUrl);
    const paymentId = randomPaymentId();
    const request = new PaymentRequest(
      // Empty transport = in-band reply (NUT-18): the payment arrives back
      // over the same mesh channel as a payment payload.
      [],
      paymentId,
      undefined,
      unit,
      mintUrls,
      undefined,
      true,
      lockPubkey ? { kind: 'P2PK', data: lockPubkey.toLowerCase(), tags: [] } : undefined
    );
    const creq = request.toEncodedRequest();

    pruneExpired();
    const issuedAt = now();
    issued.set(paymentId, {
      paymentId,
      peerId,
      creq,
      mintUrls,
      lockPubkey: lockPubkey ? lockPubkey.toLowerCase() : null,
      unit,
      issuedAt,
      expiresAt: issuedAt + ttlMs,
      consumed: false,
    });

    try {
      await config.adapter.respondToSolicit(peerId, solicitId, creq);
      logger.info('transport.responder.issued', {
        peerId,
        paymentId,
        locked: lockPubkey != null,
        mintCount: mintUrls.length,
      });
    } catch (err) {
      // The request stays issued — the sender retries the solicit and a
      // fresh request supersedes this one; expiry reaps it either way.
      logger.warn('transport.responder.respondFailed', {
        peerId,
        paymentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    start() {
      const unsubscribe = config.adapter.onInbound((event) => {
        if (event.kind !== 'solicit') return;
        void answerSolicit(event.peerId, event.solicitId, event.senderOffline);
      });
      return unsubscribe;
    },
    getOutstanding(paymentId) {
      pruneExpired();
      const request = issued.get(paymentId);
      if (!request || request.consumed) return null;
      return request;
    },
    peek(paymentId) {
      pruneExpired();
      return issued.get(paymentId) ?? null;
    },
    consume(paymentId) {
      pruneExpired();
      const request = issued.get(paymentId);
      if (!request || request.consumed) return null;
      request.consumed = true;
      return request;
    },
    clear() {
      issued.clear();
    },
  };
}
