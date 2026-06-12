// ---------------------------------------------------------------------------
// Mesh transport — shared types
//
// Colada owns the SEMANTICS of the Nut Drop NUT-18 exchange over a BLE mesh
// (bitchat): planning a send against the safety matrix, answering solicits
// with single-use payment requests, validating inbound payments, tracking
// delivery statuses, and orchestrating auto-redeem. The wallet app owns the
// BYTES: its adapter implements `MeshTransportAdapter` over the native mesh
// bridge (vendor Noise payloads 0xA0–0xA3 + the capability beacon) and hands
// colada decoded, semantic events.
// ---------------------------------------------------------------------------

/** Capability flags from the peer's last verified announce beacon. */
export interface MeshPeerCapabilities {
  /** Peer answers NUT-18 payment-request solicits over the mesh. */
  supportsNutRequests: boolean;
  /** Peer auto-redeems received ecash (informational — drives UI badges). */
  autoRedeem: boolean;
}

export type MeshPaymentStatus = 'received' | 'redeemed' | 'rejected';

/**
 * Log-grade rejection detail carried on a `rejected` status. `unknown` covers
 * reason bytes from future protocol revisions.
 */
export type MeshRejectReason = 'untrustedMint' | 'invalid' | 'mismatch' | 'duplicate' | 'unknown';

/** Decoded inbound mesh events the adapter surfaces to colada. */
export type MeshInboundEvent =
  | {
      kind: 'solicit';
      peerId: string;
      /** Correlation handle (hex) echoed back via `respondToSolicit`. */
      solicitId: string;
      /** Sender intends an offline (bearer) send — omit nut10 from the creq. */
      senderOffline: boolean;
    }
  | {
      kind: 'payment';
      peerId: string;
      /** Raw NUT-18 PaymentRequestPayload JSON (validated colada-side). */
      payloadJson: string;
    }
  | {
      kind: 'status';
      peerId: string;
      status: MeshPaymentStatus;
      reason: MeshRejectReason | 'none';
      paymentId: string;
    };

/**
 * Implemented by the wallet app over its mesh bridge. All methods may reject
 * on transport failure; colada treats rejections as delivery failures (never
 * as a downgraded success).
 */
export interface MeshTransportAdapter {
  /** Capability lookup from the last verified announce; null = no beacon (vanilla peer). */
  getPeerCapabilities(peerId: string): MeshPeerCapabilities | null;
  /**
   * Run the solicit exchange: send a solicit and resolve with the peer's
   * serialized `creq…` reply. MUST reject on timeout — "couldn't confirm
   * receiver" is an abort, never a fallback.
   */
  solicitPaymentRequest(peerId: string, opts: { senderOffline: boolean }): Promise<string>;
  /** Answer an inbound solicit with the serialized payment request. */
  respondToSolicit(peerId: string, solicitId: string, creq: string): Promise<void>;
  /** Deliver a NUT-18 PaymentRequestPayload JSON to the peer (in-band payment). */
  deliverPayment(peerId: string, payloadJson: string): Promise<void>;
  /** Send a payment status for a payment id (receiver → sender). */
  sendPaymentStatus(
    peerId: string,
    paymentId: string,
    status: MeshPaymentStatus,
    reason?: MeshRejectReason
  ): Promise<void>;
  /**
   * Public-broadcast bearer fallback for vanilla peers (visible to everyone
   * in mesh range — callers MUST gate this behind explicit consent).
   */
  broadcastBearerToken(encodedToken: string): Promise<void>;
  /** Subscribe to decoded inbound events. Returns an unsubscribe function. */
  onInbound(listener: (event: MeshInboundEvent) => void): () => void;
}

/**
 * A NUT-18 payment request parsed down to the fields the mesh flow plans
 * against. Produced by `parseMeshPaymentRequest`.
 */
export interface ParsedMeshPaymentRequest {
  /** The request's `i` — correlates the payment and its statuses. */
  paymentId: string;
  unit: string;
  /** Trusted-mints allowlist (`m`); empty = receiver accepts any mint. */
  mintUrls: string[];
  /**
   * P2PK lock target from `nut10` ("02" + x-only hex), or null for a bearer
   * request. Requests carrying a non-P2PK/unparseable condition never reach
   * this shape — parsing fails instead.
   */
  lockPubkey: string | null;
  amount?: number;
  singleUse: boolean;
  /** The original serialized request, echoed into payment payloads/UI. */
  creq: string;
}
