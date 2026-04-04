import React, { createContext, useEffect, useState, ReactNode, useRef } from 'react';
import { CocoCashuProvider } from '@cashu/coco-react';
import { Manager } from '@cashu/coco-core';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { useInitializationStage } from '@/shared/providers/InitializationProvider';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { log, initLog } from '@/shared/lib/logger';

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
    const selectedMint = 'https://mint.minibits.cash/Bitcoin';

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
          const isSovranTrusted = await manager.mint.isTrustedMint(selectedMint);
          if (isSovranTrusted) {
            setSelectedMint(pubkey, selectedMint);
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

        initLog('Coco', 'calling CocoManager.initialize()...');
        const mgr = await CocoManager.initialize();
        initLog('Coco', 'CocoManager.initialize() done');
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

        // Enable watchers/processors/NPC sync (was previously blocking init)
        initLog('Coco-bg', 'enabling watchers and NPC sync...');
        await CocoManager.enableWatchersAndSync();
        initLog('Coco-bg', 'watchers and sync done');

        const currentPubkey = keys?.pubkey;
        bgStage.log('Initializing default mints...');
        initLog('Coco-bg', 'calling initializeDefaultMints()...');
        const currentSetSelectedMint = useMintStore.getState().setSelectedMint;
        await initializeDefaultMints(manager, currentPubkey, currentSetSelectedMint);
        initLog('Coco-bg', 'initializeDefaultMints done');

        try {
          bgStage.log('Recovering pending operations...');
          initLog('Coco-bg', 'recoverPendingSendOperations...');
          await manager.ops.send.recovery.run();
          initLog('Coco-bg', 'recoverPendingMeltOperations...');
          await manager.ops.melt.recovery.run();
          initLog('Coco-bg', 'recovery done');
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

    runBackground();
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
