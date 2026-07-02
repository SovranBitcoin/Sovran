import { AppState } from 'react-native';
import {
  createMeshRedeemOrchestrator,
  type MeshRedeemOrchestrator,
  TransactionAnnotation,
} from 'wallet';
import { createDefaultOperations } from 'wallet/operations';
import { getBLEPeers } from 'bitchat-module';

import { CocoManager } from '@/shared/lib/cashu/manager';
import { peerNostrPubkey } from '@/features/nearPay/lib/peerProfile';
import { paymentStatusPopup } from '@/shared/lib/popup';
import { RECEIVE_PENDING_TOAST_COPY } from '@/shared/lib/popup/paymentStatusCopy';
import { readProfileRecord } from '@/shared/lib/nostr/useEntityCache';
import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';
import { setTransactionAnnotation } from '@/shared/stores/profile/transactionAnnotationStore';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';
import { paymentLog } from '@/shared/lib/logger';

/**
 * Drains the persisted Nut Drop redeem queue through colada's mesh redeem
 * orchestrator. Colada owns the gates (manager init, NUT-13 restore settled,
 * mint trust — never auto-trust a mint pushed at us over the mesh), the
 * retry ordering, and the receive itself (`executeAutoRedeem`, which
 * resolves the REAL persisted history id by set-difference polling —
 * retiring the old direct-coco exception). This module owns what's
 * app-shaped: the persisted queue store behind the port and the toast
 * pipeline. Tokens arrive as private Noise DMs (classified in
 * `useNutDropAutoRedeem`), so there is no sender to push status back to.
 */

function restoreSettled(): boolean {
  const status = useWalletLifecycleStore.getState().restoreStatus;
  return status === 'complete' || status === 'not-needed';
}

function getManager() {
  return CocoManager.isInitialized() ? CocoManager.getInstance() : null;
}

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

let orchestrator: MeshRedeemOrchestrator | null = null;

function getOrchestrator(): MeshRedeemOrchestrator {
  if (orchestrator) return orchestrator;

  // A dedicated default-operations bag just for the background receive —
  // the colada React instance lives in the provider tree and this drain
  // must run with no screen mounted.
  const operations = createDefaultOperations({ getManager });
  const executeAutoRedeem = operations.executeAutoRedeem;
  if (!executeAutoRedeem) throw new Error('colada executeAutoRedeem operation missing');

  orchestrator = createMeshRedeemOrchestrator({
    getManager,
    isRestoreSettled: restoreSettled,
    executeAutoRedeem,
    queue: {
      prune: () => useNutDropRedeemQueueStore.getState().prune(),
      entries: () => useNutDropRedeemQueueStore.getState().byTokenHash,
      markStatus: (tokenHash, status, error) =>
        useNutDropRedeemQueueStore.getState().markStatus(tokenHash, status, error),
      scheduleRetry: (tokenHash, error) =>
        useNutDropRedeemQueueStore.getState().scheduleRetry(tokenHash, error),
    },
    onRedeeming: (tokenHash, entry) => {
      paymentLog.info('near_pay.redeem.queue.redeeming', {
        tokenHash: tokenHash.slice(0, 12),
        ...mintUrlLogFields(entry.mintUrl),
        amount: entry.amount,
        unit: entry.unit,
        appState: AppState.currentState,
        visibleToast: AppState.currentState === 'active',
      });
      // Same toast pipeline as a manually redeemed token (processing →
      // green confirmed): coco's receive-op:finalized / history:updated
      // events flip it to confirmed through usePaymentStatusListener.
      // Only when the user can see it; backgrounded redeems surface through
      // the transaction history.
      if (AppState.currentState !== 'active') {
        paymentLog.info('near_pay.redeem.toast_suppressed', {
          tokenHash: tokenHash.slice(0, 12),
          reason: 'app_not_active',
          appState: AppState.currentState,
        });
        return;
      }
      usePaymentStatusStore.getState().setActive({
        variant: 'receive-ecash',
        id: tokenHash,
        mintUrl: entry.mintUrl,
        amount: entry.amount,
        unit: entry.unit,
        state: 'processing',
      });
      paymentStatusPopup({
        variant: 'receive-ecash',
        id: tokenHash,
        mintUrl: entry.mintUrl,
        amount: entry.amount,
        unit: entry.unit,
      });
    },
    onFailed: (tokenHash, entry, kind) => {
      paymentLog.warn('near_pay.redeem.queue.failed', {
        tokenHash: tokenHash.slice(0, 12),
        ...mintUrlLogFields(entry.mintUrl),
        amount: entry.amount,
        unit: entry.unit,
        kind,
        activeId: usePaymentStatusStore.getState().active?.id ?? null,
        activeState: usePaymentStatusStore.getState().active?.state ?? null,
      });
      // Network/retryable failures are queued for another redeem attempt, so
      // keep the visible toast pending instead of presenting a terminal error.
      if (usePaymentStatusStore.getState().active?.id !== tokenHash) {
        paymentLog.info('near_pay.redeem.toast_update_suppressed', {
          tokenHash: tokenHash.slice(0, 12),
          kind,
          reason: 'active_id_mismatch',
        });
        return;
      }
      if (kind === 'network' || kind === 'retryable') {
        paymentLog.info('near_pay.redeem.toast_waiting', {
          tokenHash: tokenHash.slice(0, 12),
          kind,
          expectedNext: 'retry_when_online_or_backoff_elapsed',
        });
        usePaymentStatusStore.getState().setWaiting(tokenHash, RECEIVE_PENDING_TOAST_COPY);
        return;
      }
      usePaymentStatusStore
        .getState()
        .setFailed(
          tokenHash,
          kind === 'spent' ? new Error('Token was already redeemed') : new Error('Redeem failed')
        );
    },
    onRedeemed: (_tokenHash, entry, historyEntryId) => {
      if (!historyEntryId) return;
      // Nut Drop tokens are P2PK-locked to us. The redeemed proofs are swapped
      // for fresh ones, so the proof-secret fallback can't see the original
      // lock — annotate the resulting receive so it shows the lock badge.
      const patch: TransactionAnnotation = {
        lock: { type: 'p2pk', direction: 'incoming' },
        // Arrived over the BLE/bitchat mesh — surfaces a bluetooth source badge.
        scan: { method: 'ble' },
      };
      // Resolve the sender's Nostr identity from the live BLE peer registry
      // (peerID → nostrPubkeyHex via the bitchat favorite exchange) so the row
      // can show their avatar. Avatar URL comes from the warm kind-0 cache when
      // present; otherwise the row falls back to a pubkey-seeded identicon.
      const peer = entry.senderPeerID
        ? getBLEPeers().find((p) => p.peerID === entry.senderPeerID)
        : undefined;
      const pubkey = peer ? peerNostrPubkey(peer) : null;
      if (pubkey) {
        const cached = readProfileRecord(pubkey);
        patch.counterparty = {
          pubkey,
          direction: 'sender',
          ...(peer?.nickname ? { displayName: peer.nickname } : {}),
          ...(cached?.picture ? { avatarUrl: cached.picture } : {}),
        };
      }
      setTransactionAnnotation(`id:${historyEntryId}`, patch);
    },
  });
  return orchestrator;
}

export async function drainNutDropRedeemQueue(): Promise<void> {
  const entries = Object.values(useNutDropRedeemQueueStore.getState().byTokenHash);
  paymentLog.info('near_pay.redeem.drain.start', {
    entries: entries.length,
    pending: entries.filter((entry) => entry.status === 'pending').length,
    redeeming: entries.filter((entry) => entry.status === 'redeeming').length,
    restoreSettled: restoreSettled(),
    hasManager: !!getManager(),
    appState: AppState.currentState,
  });
  try {
    await getOrchestrator().drain();
    paymentLog.info('near_pay.redeem.drain.done');
  } catch (error) {
    paymentLog.error('near_pay.redeem.drain.failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
