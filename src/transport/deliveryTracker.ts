// ---------------------------------------------------------------------------
// Mesh transport — delivery tracker (sender side)
//
// After a payment payload is delivered over the mesh, the receiver pushes
// 0xA3 statuses back: `received` (validated + queued), `redeemed` (swapped
// at the mint), or `rejected` (+ reason). The tracker correlates those to
// the payment ids we sent and surfaces a single ordered status stream the
// flow/UI can render ("sending → received → redeemed").
//
// `unconfirmed` is a tracker-local timeout state: the payload left our radio
// but no `received` arrived in time. It does NOT mean failure — the proofs
// may still land — which is why the sender-side reclaim decision stays with
// the user (the entry keeps listening and a late status still updates it).
// ---------------------------------------------------------------------------

import { logger } from '../logger';
import type { MeshRejectReason, MeshTransportAdapter } from './types';

export type MeshDeliveryState =
  | 'delivered'
  | 'received'
  | 'redeemed'
  | 'rejected'
  | 'unconfirmed';

export interface MeshDeliveryUpdate {
  paymentId: string;
  peerId: string;
  state: MeshDeliveryState;
  /** Populated for `rejected`. */
  rejectReason?: MeshRejectReason;
  at: number;
}

export interface MeshDeliveryTrackerConfig {
  adapter: MeshTransportAdapter;
  /** How long to wait for `received` before flagging `unconfirmed` (default 15s). */
  receivedTimeoutMs?: number;
  now?: () => number;
}

export interface MeshDeliveryTracker {
  /** Begin tracking a delivered payment. Returns stop() for this entry. */
  track(paymentId: string, peerId: string): () => void;
  getState(paymentId: string): MeshDeliveryState | null;
  /** Status stream (all tracked payments). Returns unsubscribe. */
  subscribe(listener: (update: MeshDeliveryUpdate) => void): () => void;
  /** Stop everything (profile switch / shutdown). */
  dispose(): void;
}

const DEFAULT_RECEIVED_TIMEOUT_MS = 15_000;

/** Forward state only — a late `received` must not regress `redeemed`. */
const STATE_ORDER: Record<MeshDeliveryState, number> = {
  delivered: 0,
  unconfirmed: 1,
  received: 2,
  redeemed: 3,
  rejected: 3,
};

interface TrackedDelivery {
  peerId: string;
  state: MeshDeliveryState;
  timeout: ReturnType<typeof setTimeout> | null;
}

export function createMeshDeliveryTracker(
  config: MeshDeliveryTrackerConfig
): MeshDeliveryTracker {
  const receivedTimeoutMs = config.receivedTimeoutMs ?? DEFAULT_RECEIVED_TIMEOUT_MS;
  const now = config.now ?? Date.now;
  const tracked = new Map<string, TrackedDelivery>();
  const listeners = new Set<(update: MeshDeliveryUpdate) => void>();

  function emit(paymentId: string, entry: TrackedDelivery, rejectReason?: MeshRejectReason): void {
    const update: MeshDeliveryUpdate = {
      paymentId,
      peerId: entry.peerId,
      state: entry.state,
      ...(rejectReason ? { rejectReason } : {}),
      at: now(),
    };
    for (const listener of listeners) listener(update);
  }

  function advance(
    paymentId: string,
    nextState: MeshDeliveryState,
    rejectReason?: MeshRejectReason
  ): void {
    const entry = tracked.get(paymentId);
    if (!entry) return;
    if (STATE_ORDER[nextState] <= STATE_ORDER[entry.state] && nextState !== entry.state) {
      return;
    }
    if (entry.timeout && nextState !== 'unconfirmed') {
      clearTimeout(entry.timeout);
      entry.timeout = null;
    }
    if (entry.state === nextState) return;
    entry.state = nextState;
    logger.info('transport.delivery.state', { paymentId, state: nextState, rejectReason });
    emit(paymentId, entry, rejectReason);
  }

  const unsubscribeAdapter = config.adapter.onInbound((event) => {
    if (event.kind !== 'status') return;
    const entry = tracked.get(event.paymentId);
    // Statuses must come from the peer we paid — anyone else echoing our
    // payment id is foreign content and drops.
    if (!entry || entry.peerId !== event.peerId) return;
    if (event.status === 'received') advance(event.paymentId, 'received');
    else if (event.status === 'redeemed') advance(event.paymentId, 'redeemed');
    else if (event.status === 'rejected') {
      advance(event.paymentId, 'rejected', event.reason === 'none' ? 'unknown' : event.reason);
    }
  });

  return {
    track(paymentId, peerId) {
      const existing = tracked.get(paymentId);
      if (existing?.timeout) clearTimeout(existing.timeout);
      const entry: TrackedDelivery = {
        peerId,
        state: 'delivered',
        timeout: setTimeout(() => advance(paymentId, 'unconfirmed'), receivedTimeoutMs),
      };
      tracked.set(paymentId, entry);
      emit(paymentId, entry);
      return () => {
        const current = tracked.get(paymentId);
        if (current?.timeout) clearTimeout(current.timeout);
        tracked.delete(paymentId);
      };
    },
    getState(paymentId) {
      return tracked.get(paymentId)?.state ?? null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      unsubscribeAdapter();
      for (const entry of tracked.values()) {
        if (entry.timeout) clearTimeout(entry.timeout);
      }
      tracked.clear();
      listeners.clear();
    },
  };
}
