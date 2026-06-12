import type { BitchatBLEIdentityMaterial } from 'bitchat-module';
import {
  createMeshDeliveryTracker,
  createMeshPaymentIntake,
  createMeshRequestResponder,
  type MeshDeliveryTracker,
  type MeshTransportAdapter,
} from '@sovranbitcoin/colada';

import { createBitchatMeshTransportAdapter } from '@/features/bitchat/lib/meshTransportAdapter';
import { sendBLEPublicMessage } from '@/features/bitchat/lib/blePrivateDelivery';
import { getBitchatNickname } from '@/features/bitchat/hooks/useBitchatNickname';
import { getBitchatProfileScope } from '@/features/bitchat/lib/profileScope';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { paymentLog } from '@/shared/lib/logger';
import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';

/**
 * Profile-scoped mesh Nut Drop runtime: ONE adapter over the BLE bridge plus
 * colada's receiver pipeline (request responder answering solicits, payment
 * intake validating + enqueueing in-band payments) and the sender-side
 * delivery tracker. Started/stopped by `useNutDropAutoRedeem` so its
 * lifetime — and the P2PK receive key it answers solicits with — always
 * tracks the ACTIVE profile.
 */
interface MeshNutDropRuntime {
  adapter: MeshTransportAdapter;
  tracker: MeshDeliveryTracker;
  stops: Array<() => void>;
}

let runtime: MeshNutDropRuntime | null = null;

interface StartMeshNutDropOptions {
  /** "02" + the active profile's x-only Nostr pubkey. */
  p2pkReceiveKey: string;
  getIdentityMaterial: () => BitchatBLEIdentityMaterial | null;
  /** A validated in-band payment was enqueued — kick the redeem drain. */
  onPaymentAccepted: () => void;
}

export function startMeshNutDrop(options: StartMeshNutDropOptions): void {
  stopMeshNutDrop();

  const adapter = createBitchatMeshTransportAdapter({
    broadcastBearerToken: async (encodedToken) => {
      await sendBLEPublicMessage({
        content: encodedToken,
        nickname: getBitchatNickname() || 'sovran',
        profileScope: getBitchatProfileScope(),
        identityMaterial: options.getIdentityMaterial(),
      });
    },
  });

  const responder = createMeshRequestResponder({
    adapter,
    getP2pkReceiveKey: () => options.p2pkReceiveKey,
    getTrustedMintUrls: async () => {
      if (!CocoManager.isInitialized()) return [];
      const mints = await CocoManager.getInstance().mint.getAllTrustedMints();
      return mints.map((mint) => mint.mintUrl);
    },
  });

  const intake = createMeshPaymentIntake({
    adapter,
    responder,
    queue: {
      entries: () => useNutDropRedeemQueueStore.getState().byTokenHash,
      enqueue: (tokenHash, entry) =>
        useNutDropRedeemQueueStore.getState().enqueue(tokenHash, {
          token: entry.token,
          mintUrl: entry.mintUrl,
          amount: entry.amount,
          unit: entry.unit,
          senderPeerID: entry.senderPeerID,
          paymentId: entry.paymentId,
        }),
    },
    onAccepted: () => options.onPaymentAccepted(),
  });

  const tracker = createMeshDeliveryTracker({ adapter });
  // Structured log per delivery transition (delivered → received →
  // redeemed / rejected / unconfirmed) — the log-doctor surface for the
  // manual QA matrix until a dedicated radar status UI consumes the stream.
  const unsubscribeTracker = tracker.subscribe((update) => {
    paymentLog.info('near_pay.mesh.delivery_update', {
      paymentId: update.paymentId,
      peerID: update.peerId,
      state: update.state,
      rejectReason: update.rejectReason,
    });
  });

  runtime = {
    adapter,
    tracker,
    stops: [
      responder.start(),
      intake.start(),
      unsubscribeTracker,
      () => tracker.dispose(),
      () => responder.clear(),
    ],
  };
  paymentLog.info('near_pay.mesh.runtime_started');
}

export function stopMeshNutDrop(): void {
  if (!runtime) return;
  for (const stop of runtime.stops) {
    try {
      stop();
    } catch {
      // Teardown is best-effort.
    }
  }
  runtime = null;
  paymentLog.info('near_pay.mesh.runtime_stopped');
}

/** The live adapter, or null while the runtime is down (no active profile). */
export function getMeshTransportAdapter(): MeshTransportAdapter | null {
  return runtime?.adapter ?? null;
}

/**
 * Track a freshly delivered payment so its status stream (received →
 * redeemed / rejected) flows. Called from the mesh send completion seam;
 * no-op when the runtime is down.
 */
export function trackMeshDelivery(paymentId: string, peerId: string): void {
  runtime?.tracker.track(paymentId, peerId);
}
