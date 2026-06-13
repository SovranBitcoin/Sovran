import { AppState } from 'react-native';
import { createMeshRedeemOrchestrator, type MeshRedeemOrchestrator } from '@sovranbitcoin/colada';
import { createDefaultOperations } from '@sovranbitcoin/colada/operations';

import { CocoManager } from '@/shared/lib/cashu/manager';
import { paymentStatusPopup } from '@/shared/lib/popup';
import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';

/**
 * Drains the persisted Nut Drop redeem queue through colada's mesh redeem
 * orchestrator. Colada owns the gates (manager init, NUT-13 restore settled,
 * mint trust — never auto-trust a mint pushed at us over the mesh), the
 * retry ordering, and the receive itself (`executeAutoRedeem`, which
 * resolves the REAL persisted history id by set-difference polling —
 * retiring the old direct-coco exception). This module owns what's
 * app-shaped: the persisted queue store behind the port and the toast
 * pipeline. Tokens arrive as public-mesh broadcasts (classified in
 * `useNutDropAutoRedeem`), so there is no sender to push status back to.
 */

function restoreSettled(): boolean {
  const status = useWalletLifecycleStore.getState().restoreStatus;
  return status === 'complete' || status === 'not-needed';
}

function getManager() {
  return CocoManager.isInitialized() ? CocoManager.getInstance() : null;
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
      // Same toast pipeline as a manually redeemed token (processing →
      // green confirmed): coco's receive-op:finalized / history:updated
      // events flip it to confirmed through usePaymentStatusListener.
      // Only when the user can see it; backgrounded redeems surface through
      // the transaction history.
      if (AppState.currentState !== 'active') return;
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
    onFailed: (tokenHash, _entry, kind) => {
      // Don't leave a mounted toast spinning forever — flip it to the
      // standard failed state (the retry path mounts a fresh one later).
      if (usePaymentStatusStore.getState().active?.id !== tokenHash) return;
      usePaymentStatusStore
        .getState()
        .setFailed(
          tokenHash,
          kind === 'spent' ? new Error('Token was already redeemed') : new Error('Redeem failed')
        );
    },
  });
  return orchestrator;
}

export async function drainNutDropRedeemQueue(): Promise<void> {
  await getOrchestrator().drain();
}
