import React, { createContext, useEffect, useState, ReactNode, useRef } from 'react';
import { CocoCashuProvider } from '@cashu/coco-react';
import { Manager } from '@cashu/coco-core';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { useInitializationStage } from '@/shared/providers/InitializationProvider';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { log, initLog, initPhase, useInitMount, deferWork } from '@/shared/lib/logger';
import { getBootMorphCompleted, subscribeBootMorphCompleted } from '@/shared/lib/qrButtonAnchor';
import {
  useWalletLifecycleStore,
  type RestoreStatus,
} from '@/shared/stores/global/walletLifecycleStore';

initLog('Module', 'CocoProvider loaded');

/**
 * Resolves once the wallet-lifecycle restoreStatus is 'complete' or 'not-needed'
 * — the safe-to-mint signal. Used to gate NPC sync + the mint-operation
 * processor so they don't fire on a counter the mint already signed.
 */
function awaitRestoreReady(): Promise<void> {
  const isReady = (s: RestoreStatus) => s === 'complete' || s === 'not-needed';
  const initial = useWalletLifecycleStore.getState().restoreStatus;
  if (isReady(initial)) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const unsubscribe = useWalletLifecycleStore.subscribe((state, prev) => {
      if (state.restoreStatus !== prev.restoreStatus && isReady(state.restoreStatus)) {
        unsubscribe();
        resolve();
      }
    });
  });
}

interface CocoContextValue {
  manager: Manager | null;
  isReady: boolean;
  isMigrating: boolean;
  migrationError: Error | null;
}

const CocoContext = createContext<CocoContextValue>({
  manager: null,
  isReady: false,
  isMigrating: false,
  migrationError: null,
});

interface CocoProviderProps {
  children: ReactNode;
}

async function initializeDefaultMints(
  manager: Manager,
  pubkey?: string,
  setSelectedMint?: (pubkey: string, mintUrl: string) => void
): Promise<void> {
  try {
    log.info('coco.init_default_mints');

    const defaultMints = ['https://mint.sovran.money', 'https://mint.minibits.cash/Bitcoin'];
    const defaultSelectedMint = 'https://mint.minibits.cash/Bitcoin';

    for (const mintUrl of defaultMints) {
      try {
        const isKnown = await manager.mint.isTrustedMint(mintUrl);
        if (isKnown) {
          log.debug('coco.mint_exists', { mintUrl });
          continue;
        }

        await manager.mint.addMint(mintUrl, { trusted: true });
        log.info('coco.mint_added', { mintUrl });
      } catch (error) {
        log.warn('coco.mint_add_failed', { mintUrl, error });
      }
    }

    if (pubkey && setSelectedMint) {
      try {
        const getSelectedMint = useMintStore.getState().getSelectedMint;
        const currentSelectedMint = getSelectedMint(pubkey);

        if (!currentSelectedMint) {
          const isDefaultTrusted = await manager.mint.isTrustedMint(defaultSelectedMint);
          if (isDefaultTrusted) {
            setSelectedMint(pubkey, defaultSelectedMint);
            log.info('coco.mint_selected', { pubkey });
          }
        }
      } catch (error) {
        log.warn('coco.mint_select_failed', { error });
      }
    }

    log.info('coco.init_default_mints_done');
  } catch (error) {
    log.error('coco.init_default_mints_failed', { error });
  }
}

/**
 * CocoProvider initializes the Coco Manager for normal runtime use.
 *
 * Startup is split into two phases:
 *  - **Blocking** (`coco` stage): Manager init. The app stays on the splash
 *    screen until this completes.
 *  - **Non-blocking** (`coco-background` stage): Default mints + recovery.
 *    These run after the app is visible and don't hold up rendering.
 */
export function CocoProvider({ children }: CocoProviderProps) {
  useInitMount('CocoProvider');
  const stage = useInitializationStage('coco', {
    message: 'Initializing Coco...',
    dependsOn: ['nostr'],
    blocking: true,
  });
  const bgStage = useInitializationStage('coco-background', {
    message: 'Background tasks...',
    dependsOn: ['coco'],
    blocking: false,
  });
  const { keys } = useNostrKeysContext();
  const [manager, setManager] = useState<Manager | null>(null);
  const [isReady, setIsReady] = useState(false);
  const isMigrating = false;
  const [migrationError, setMigrationError] = useState<Error | null>(null);
  const hasStarted = useRef(false);
  const bgStarted = useRef(false);

  // Phase 1: Blocking — Manager init + data migration
  useEffect(() => {
    if (!stage.canStart) return;
    if (hasStarted.current) return;
    hasStarted.current = true;

    const initializeCoco = async () => {
      try {
        stage.log('Initializing Coco...');
        initLog('Coco', 'Phase 1 starting');

        // Pass the already-derived private key so CocoManager doesn't re-derive
        if (keys?.privateKey) {
          CocoManager.setSignerKey(keys.privateKey);
        }

        const mgr = await initPhase('Coco.managerInit', () => CocoManager.initialize());
        setManager(mgr);

        initLog('Coco', 'setting isReady=true, calling stage.complete()');
        setIsReady(true);
        stage.complete();
        initLog('Coco', 'Phase 1 complete');
      } catch (error) {
        initLog('Coco', `Phase 1 ERROR: ${error}`);
        const errorMessage = error instanceof Error ? error.message : 'Initialization failed';
        setMigrationError(error instanceof Error ? error : new Error('Initialization failed'));
        stage.error(errorMessage);
      }
    };

    initializeCoco();

    return () => {
      CocoManager.cleanup().catch((error) => {
        log.error('coco.cleanup_failed', { error });
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.canStart, keys?.pubkey]);

  // Phase 2: Non-blocking — Default mints + recovery (runs after app is visible)
  useEffect(() => {
    if (!bgStage.canStart) return;
    if (!manager) return;
    if (bgStarted.current) return;
    bgStarted.current = true;

    const runBackground = async () => {
      try {
        initLog('Coco-bg', 'Phase 2 starting');

        // Safe to enable observe-only watchers and pre-warm the seed cache
        // immediately — neither uses the deterministic counter.
        await initPhase('Coco-bg.safeWatchers', () => CocoManager.enableSafeWatchers());

        const currentPubkey = keys?.pubkey;
        bgStage.log('Initializing default mints...');
        const currentSetSelectedMint = useMintStore.getState().setSelectedMint;
        await initPhase('Coco-bg.defaultMints', () =>
          initializeDefaultMints(manager, currentPubkey, currentSetSelectedMint)
        );

        // Block NPC sync + the mint-operation processor until the wallet
        // has restored its NUT-13 counter (or proven restore isn't needed).
        // RestoreGate routes the user to /restore when this is pending.
        bgStage.log('Waiting for wallet restore...');
        await initPhase('Coco-bg.restoreReady', () => awaitRestoreReady());
        bgStage.log('Starting NPC sync...');
        await initPhase('Coco-bg.npcSync', () => CocoManager.enableNpcSyncAndProcessor());

        try {
          bgStage.log('Recovering pending operations...');
          await initPhase('Coco-bg.sendRecovery', () => manager.ops.send.recovery.run());
          await initPhase('Coco-bg.meltRecovery', () => manager.ops.melt.recovery.run());
        } catch (recoveryErr) {
          initLog('Coco-bg', `recovery failed (non-fatal): ${recoveryErr}`);
        }

        bgStage.complete();
        initLog('Coco-bg', 'Phase 2 complete');
      } catch (error) {
        initLog('Coco-bg', `Phase 2 failed (non-fatal): ${error}`);
        bgStage.complete();
      }
    };

    // Wait for the splash → QR button morph to settle before starting
    // heavy background work (default mints, NPC sync, recovery). The fixed
    // 2-second delay we used before was a conservative estimate of "is the
    // morph done"; tying it directly to the morph signal saves ~1.5s on a
    // typical boot. The 500ms timeout is a safety net for the case where
    // the morph never fires (e.g., user lands on onboarding instead of the
    // wallet, or Coco init beat the user to a screen with a QRButton).
    let started = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;
    let deferHandle: { cancel: () => void } | null = null;

    const start = () => {
      if (started) return;
      started = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      unsubscribe?.();
      unsubscribe = null;
      // Tiny extra defer keeps Phase 2's first await off the morph's last
      // animation frame.
      deferHandle = deferWork('coco.phase2', runBackground, 50);
    };

    if (getBootMorphCompleted()) {
      start();
    } else {
      unsubscribe = subscribeBootMorphCompleted((completed) => {
        if (completed) start();
      });
      // Safety fallback — start anyway after 500ms even without a morph
      // completion signal, so background sync is never indefinitely
      // postponed on screens that never mount the QRButton.
      timeoutHandle = setTimeout(start, 500);
    }

    return () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      unsubscribe?.();
      deferHandle?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgStage.canStart, manager, keys?.pubkey]);

  const contextValue: CocoContextValue = {
    manager,
    isReady,
    isMigrating,
    migrationError,
  };

  if (!isReady || !manager) {
    return <CocoContext.Provider value={contextValue}>{null}</CocoContext.Provider>;
  }

  return (
    <CocoContext.Provider value={contextValue}>
      <CocoCashuProvider manager={manager}>{children}</CocoCashuProvider>
    </CocoContext.Provider>
  );
}
