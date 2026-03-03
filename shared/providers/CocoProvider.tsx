import React, { createContext, useEffect, useState, ReactNode, useRef } from 'react';
import { CocoCashuProvider } from 'coco-cashu-react';
import { Manager } from 'coco-cashu-core';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { DataMigration } from '@/shared/lib/cashu/migration';
import { useInitializationStage } from '@/shared/providers/InitializationProvider';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { initLog } from '@/shared/lib/initTiming';

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
    console.log('Initializing default mints...');

    const defaultMints = ['https://mint.sovran.money', 'https://mint.minibits.cash/Bitcoin'];
    const selectedMint = 'https://mint.minibits.cash/Bitcoin';

    for (const mintUrl of defaultMints) {
      try {
        const isKnown = await manager.mint.isTrustedMint(mintUrl);
        if (isKnown) {
          console.log(`Default mint already exists: ${mintUrl}`);
          continue;
        }

        await manager.mint.addMint(mintUrl, { trusted: true });
        console.log(`Added default mint: ${mintUrl}`);
      } catch (error) {
        console.warn(`Failed to add default mint ${mintUrl}:`, error);
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
            console.log(`Set Sovran mint as selected for pubkey: ${pubkey}`);
          }
        }
      } catch (error) {
        console.warn(`Failed to set default selected mint:`, error);
      }
    }

    console.log('Default mints initialization completed');
  } catch (error) {
    console.error('Failed to initialize default mints:', error);
  }
}

/**
 * CocoProvider initializes the Coco Manager and runs data migration.
 *
 * Startup is split into two phases:
 *  - **Blocking** (`coco` stage): Manager init + data migration. The app stays
 *    on the splash screen until this completes.
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
  const [isMigrating, setIsMigrating] = useState(false);
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

        const activeAccountIndex = useProfileStore.getState().activeAccountIndex;
        const migrationAlreadyDone = useProfileStore
          .getState()
          .isCocoMigrationComplete(activeAccountIndex);
        initLog(
          'Coco',
          `account=${activeAccountIndex} migrationAlreadyDone=${migrationAlreadyDone}`
        );

        if (migrationAlreadyDone) {
          initLog('Coco', 'skipping migration check (already done)');
        } else {
          stage.log('Checking for data migration...');
          initLog('Coco', 'creating DataMigration instance...');
          const migration = new DataMigration(mgr, activeAccountIndex);
          initLog('Coco', 'calling isMigrationNeeded()...');
          const needsMigration = await migration.isMigrationNeeded();
          initLog('Coco', `isMigrationNeeded = ${needsMigration}`);

          if (needsMigration) {
            stage.log('Migrating data...');
            initLog('Coco', 'starting migrateFromRedux()...');
            setIsMigrating(true);

            try {
              const result = await migration.migrateFromRedux();
              initLog('Coco', `migrateFromRedux done — errors=${result.errors.length}`);
              if (result.errors.length > 0) {
                console.warn('Migration completed with errors:', result.errors);
              }
            } catch (error) {
              initLog('Coco', `migrateFromRedux ERROR: ${error}`);
              setMigrationError(error instanceof Error ? error : new Error('Migration failed'));
            } finally {
              setIsMigrating(false);
            }
          }

          initLog('Coco', 'marking migration complete in profileStore');
          useProfileStore.getState().markCocoMigrationComplete(activeAccountIndex);
        }

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
        console.error('Failed to cleanup Coco Manager on unmount:', error);
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
          await manager.recoverPendingSendOperations();
          initLog('Coco-bg', 'recoverPendingMeltOperations...');
          await manager.recoverPendingMeltOperations();
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
