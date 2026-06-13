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

import { PaymentRequest, PaymentRequestTransportType } from '@cashu/cashu-ts';
import { logger } from '../logger';
import { normalizeMintUrl } from './plan';
import type { MeshTransportAdapter } from './types';

const DEFAULT_REQUEST_TTL_MS = 120_000;
const P2PK_RECEIVE_KEY_PATTERN = /^02[0-9a-f]{64}$/i;
/** Flood guards: a hostile peer spamming solicits must not grow the issued
 * map (memory) or buy unbounded encode/send work (CPU) — within one TTL a
 * peer gets a handful of live requests, the mesh a bounded total. */
const MAX_LIVE_REQUESTS = 64;
const MAX_LIVE_REQUESTS_PER_PEER = 4;

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
  /**
   * The receiver's Nostr identity as an `nprofile1…` string. When present,
   * issued requests carry a standard NUT-18 nostr transport entry
   * (`{type:"nostr", target:nprofile, tags:[["n","17"]]}`) — the spec-native
   * way to disclose who is being paid (and a future NIP-17 DM delivery
   * fallback). Mesh delivery stays in-band: the sender's mesh branch is
   * selected by peer, not by the transport list. Null = no identity
   * disclosure (request ships with an empty transport list).
   */
  getNostrTransportTarget?: () => string | null;
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
    pruneExpired();
    let total = 0;
    let fromPeer = 0;
    for (const request of issued.values()) {
      if (request.consumed) continue;
      total += 1;
      if (request.peerId === peerId) fromPeer += 1;
    }
    if (total >= MAX_LIVE_REQUESTS || fromPeer >= MAX_LIVE_REQUESTS_PER_PEER) {
      logger.warn('transport.responder.floodCapped', { peerId, total, fromPeer });
      return;
    }

    const lockPubkey = senderOffline ? null : config.getP2pkReceiveKey();
    if (!senderOffline && !P2PK_RECEIVE_KEY_PATTERN.test(lockPubkey ?? '')) {
      // No usable lock key for an online (locked) solicit: stay silent. The
      // sender's solicit timeout reads as "couldn't confirm receiver" — never
      // hand out a bearer request the sender didn't ask for.
      logger.warn('transport.responder.noReceiveKey', { peerId });
      return;
    }

    // The creq carries the wallet's mint URLs VERBATIM — the sender's
    // machine intersects them against its own raw wallet URLs (same as any
    // non-mesh creq), so rewriting the casing here would break legitimate
    // matches. Normalization is comparison-time only: the issued record
    // below stores normalized URLs for inbound-payment validation.
    const trustedMintUrls = await config.getTrustedMintUrls();
    const paymentId = randomPaymentId();
    // The nostr transport entry discloses the receiver's identity to the
    // soliciting peer (NIP-17 tag per NUT-18 convention). Without one the
    // transport list is empty = in-band reply; WITH one, mesh delivery is
    // still in-band — the sender pays the peer it solicited, and inbound
    // validation matches on payment id, never on transport.
    const nostrTarget = config.getNostrTransportTarget?.() ?? null;
    const transports = nostrTarget
      ? [{ type: PaymentRequestTransportType.NOSTR, target: nostrTarget, tags: [['n', '17']] }]
      : [];
    const request = new PaymentRequest(
      transports,
      paymentId,
      undefined,
      unit,
      trustedMintUrls,
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
      mintUrls: trustedMintUrls.map(normalizeMintUrl),
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
        mintCount: trustedMintUrls.length,
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
