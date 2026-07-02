import React, { createContext, useEffect, useState, ReactNode, useRef } from 'react';
import { CocoCashuProvider } from '@cashu/coco-react';
import { Manager } from '@cashu/coco-core';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { reportCocoApiFailure } from '@/shared/lib/cashu/cocoFeedback';
import { useInitializationStage } from '@/shared/providers/InitializationProvider';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { attachMintMetadataToManager } from '@/shared/stores/global/mintMetadataStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { log, initLog, initPhase, useInitMount, deferWork } from '@/shared/lib/logger';
import { getBootMorphCompleted, subscribeBootMorphCompleted } from '@/shared/lib/qrButtonAnchor';
import { awaitRestoreReady } from '@/shared/providers/awaitRestoreReady';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';

initLog('Module', 'CocoProvider loaded');

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

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

function defaultSelectedMintLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasDefaultSelectedMint: !!mintUrl,
    defaultSelectedMintLength: mintUrl?.length ?? 0,
  };
}

async function initializeDefaultMints(manager: Manager): Promise<void> {
  try {
    // Default mint set installed on first run. Mirrors numo's curated list
    // (minibits + chorus + cubabitcoin) plus our own mint.sovran.money, but
    // deliberately excludes coinos. Sovran's own mint is the default selection.
    const defaultMints = [
      'https://mint.sovran.money',
      'https://mint.minibits.cash/Bitcoin',
      'https://mint.chorus.community',
      'https://mint.cubabitcoin.org',
    ];
    const defaultSelectedMint = 'https://mint.sovran.money';
    log.info('coco.init_default_mints', {
      defaultMintCount: defaultMints.length,
      ...defaultSelectedMintLogFields(defaultSelectedMint),
    });

    for (const mintUrl of defaultMints) {
      try {
        log.debug('coco.mint_trust_check.start', { ...mintUrlLogFields(mintUrl) });
        const isKnown = await manager.mint.isTrustedMint(mintUrl);
        if (isKnown) {
          log.debug('coco.mint_exists', { ...mintUrlLogFields(mintUrl) });
          continue;
        }

        await manager.mint.addMint(mintUrl, { trusted: true });
        log.info('coco.mint_added', { ...mintUrlLogFields(mintUrl) });
      } catch (error) {
        log.warn('coco.mint_add_failed', { ...mintUrlLogFields(mintUrl), error });
      }
    }

    try {
      const { selectedMint, setSelectedMint } = useMintStore.getState();
      log.debug('coco.default_mint_selection.check', {
        hasSelectedMint: !!selectedMint,
        ...defaultSelectedMintLogFields(defaultSelectedMint),
      });
      if (!selectedMint) {
        const isDefaultTrusted = await manager.mint.isTrustedMint(defaultSelectedMint);
        if (isDefaultTrusted) {
          setSelectedMint(defaultSelectedMint);
          log.info('coco.mint_selected', { ...mintUrlLogFields(defaultSelectedMint) });
        } else {
          log.warn('coco.default_mint_not_trusted', { ...mintUrlLogFields(defaultSelectedMint) });
        }
      }
    } catch (error) {
      log.warn('coco.mint_select_failed', { error });
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
        log.info('coco.phase1.start', {
          hasKeys: !!keys,
          hasPrivateKey: !!keys?.privateKey,
        });

        // Pass the already-derived private key so CocoManager doesn't re-derive
        if (keys?.privateKey) {
          CocoManager.setSignerKey(keys.privateKey);
        } else {
          log.warn('coco.phase1.no_private_key_for_manager');
        }

        const mgr = await initPhase('Coco.managerInit', () => CocoManager.initialize());
        setManager(mgr);
        log.info('coco.phase1.manager_ready');

        initLog('Coco', 'setting isReady=true, calling stage.complete()');
        setIsReady(true);
        stage.complete();
        initLog('Coco', 'Phase 1 complete');
        log.info('coco.phase1.done');
      } catch (error) {
        initLog('Coco', `Phase 1 ERROR: ${error}`);
        const errorMessage = error instanceof Error ? error.message : 'Initialization failed';
        log.error('coco.phase1.failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        setMigrationError(error instanceof Error ? error : new Error('Initialization failed'));
        stage.error(errorMessage);
      }
    };

    void initializeCoco();

    return () => {
      // Reset the start-guard so a deps change (e.g. profile switch flipping
      // keys.pubkey) re-runs init for the new identity. Without this, the
      // cleanup tears down the singleton but the re-run sees hasStarted=true
      // and bails out, leaving the new profile without a manager.
      hasStarted.current = false;
      setManager(null);
      setIsReady(false);
      log.info('coco.phase1.cleanup_requested');
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
        log.info('coco.phase2.start');

        // Safe to enable observe-only watchers and pre-warm the seed cache
        // immediately — neither uses the deterministic counter.
        await initPhase('Coco-bg.safeWatchers', () => CocoManager.enableSafeWatchers());

        bgStage.log('Initializing default mints...');
        await initPhase('Coco-bg.defaultMints', () => initializeDefaultMints(manager));

        // Block NPC sync + the mint-operation processor until the wallet
        // has restored its NUT-13 counter (or proven restore isn't needed).
        // RestoreGate routes the user to /restore when this is pending.
        bgStage.log('Waiting for wallet restore...');
        await initPhase('Coco-bg.restoreReady', () => awaitRestoreReady(useWalletLifecycleStore));
        bgStage.log('Starting NPC sync...');
        await initPhase('Coco-bg.npcSync', () => CocoManager.enableNpcSyncAndProcessor());

        try {
          bgStage.log('Recovering pending operations...');
          log.info('coco.recovery.send.start');
          await initPhase('Coco-bg.sendRecovery', () => manager.ops.send.recovery.run());
          log.info('coco.recovery.send.done');
          log.info('coco.recovery.melt.start');
          await initPhase('Coco-bg.meltRecovery', () => manager.ops.melt.recovery.run());
          log.info('coco.recovery.melt.done');
          log.info('coco.recovery.receive.start');
          await initPhase('Coco-bg.receiveRecovery', () => manager.ops.receive.recovery.run());
          log.info('coco.recovery.receive.done');
          // Safe no-op sweep while the NUT-18 incoming saga is unused.
          log.info('coco.recovery.payment_request_receive.start');
          await initPhase('Coco-bg.paymentRequestReceiveRecovery', () =>
            manager.recoverPendingPaymentRequestReceiveAttempts()
          );
          log.info('coco.recovery.payment_request_receive.done');
        } catch (recoveryErr) {
          initLog('Coco-bg', `recovery failed (non-fatal): ${recoveryErr}`);
          log.warn('coco.recovery.failed', {
            error: recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr),
          });
          reportCocoApiFailure('ops.*.recovery.run', recoveryErr);
        }

        bgStage.complete();
        initLog('Coco-bg', 'Phase 2 complete');
        log.info('coco.phase2.done');
      } catch (error) {
        initLog('Coco-bg', `Phase 2 failed (non-fatal): ${error}`);
        log.warn('coco.phase2.failed', {
          error: error instanceof Error ? error.message : String(error),
        });
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
      log.info('coco.phase2.defer_start');
      deferHandle = deferWork('coco.phase2', runBackground, 50);
    };

    if (getBootMorphCompleted()) {
      log.debug('coco.phase2.boot_morph_already_done');
      start();
    } else {
      log.debug('coco.phase2.wait_boot_morph');
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
      log.info('coco.phase2.cleanup');
      // Symmetric to Phase 1: a deps change (profile switch via keys.pubkey,
      // or a re-init that produced a fresh manager) must allow the bg work
      // to re-run for the new identity. Without this, the new manager never
      // gets NPC sync + recovery.
      bgStarted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgStage.canStart, manager, keys?.pubkey]);

  // Keep the mint-info SWR cache in sync with coco's DB. mint:updated /
  // mint:added fire from recovery, addMintByUrl, and the per-mint refresh
  // inside ensureUpdatedMint — paths that don't necessarily route through
  // `getCachedMintInfo`. Without this subscription, those refreshes would
  // sit in coco's DB while our cache served stale data until its 24h SWR
  // window elapsed.
  useEffect(() => {
    if (!manager) return;
    log.info('coco.mint_info_cache.attach');
    return attachMintMetadataToManager(manager);
  }, [manager]);

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
