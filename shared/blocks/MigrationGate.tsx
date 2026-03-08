import React, { useState, useEffect, ReactNode, useRef } from 'react';
import { store } from '@/redux/store/store.deprecated';
import { useInitializationStage } from '@/shared/providers/InitializationProvider';
import { isMigrationsComplete, setMigrationsComplete } from '@/shared/lib/nostr/secureStorage';
import { initLog } from '@/shared/lib/initTiming';
import { useProfileStore } from '@/shared/stores/global/profileStore';

interface MigrationGateProps {
  children: ReactNode;
}

/**
 * MigrationGate ensures legacy Redux migrations complete before rendering children.
 *
 * On the first launch (or after a cache clear) it waits for Redux rehydration
 * and async migration polling, then persists a completion flag to SecureStore.
 * On subsequent launches the flag is found immediately and children render
 * with zero delay.
 *
 * Global profile-scoped key migrations are handled separately by
 * GlobalMigrationGate (runs before AccountScopedProviders mount).
 */
export default function MigrationGate({ children }: MigrationGateProps) {
  const stage = useInitializationStage('migrations', {
    message: 'Running migrations...',
    blocking: true,
    dependsOn: ['global-migrations'],
  });
  const [migrationsComplete, setMigrationsCompleteDone] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    const checkMigrationsComplete = async () => {
      try {
        setIsChecking(true);
        const accountIndex = useProfileStore.getState().activeAccountIndex;
        initLog('MigrationGate', `starting migration check for account ${accountIndex}`);

        initLog('MigrationGate', 'reading SecureStore flag...');
        const alreadyDone = await isMigrationsComplete(accountIndex);
        initLog('MigrationGate', `SecureStore flag = ${alreadyDone}`);
        if (alreadyDone) {
          setMigrationsCompleteDone(true);
          stage.log('Migrations already complete');
          stage.complete();
          initLog('MigrationGate', 'fast-path complete');
          return;
        }

        stage.log('Running migrations...');
        initLog('MigrationGate', 'no cached flag — running full migration flow');

        stage.log('Rehydrating Redux store...');
        initLog('MigrationGate', 'waiting for Redux rehydration...');
        await new Promise<void>((resolve) => {
          const unsubscribe = store.subscribe(() => {
            const state = store.getState();
            if (state._persist && state._persist.rehydrated) {
              unsubscribe();
              resolve();
            }
          });

          const currentState = store.getState();
          if (currentState._persist && currentState._persist.rehydrated) {
            unsubscribe();
            resolve();
          }
        });
        initLog('MigrationGate', 'Redux store rehydrated');

        stage.log('Waiting for migrations to complete...');
        initLog('MigrationGate', 'polling for async migration status...');

        let attempts = 0;
        const maxAttempts = 60;
        const pollInterval = 500;

        while (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, pollInterval));

          const currentState = store.getState();
          const migrationStatus = (currentState as any)?._migrationStatus;

          const allMigrationsComplete =
            !migrationStatus || migrationStatus.migration250Complete !== false;

          if (allMigrationsComplete) {
            initLog('MigrationGate', `async migrations done after ${attempts} polls`);
            break;
          }

          attempts++;

          if (attempts % 10 === 0) {
            initLog('MigrationGate', `still polling... attempt ${attempts}/${maxAttempts}`);
          }
        }

        if (attempts >= maxAttempts) {
          initLog('MigrationGate', 'TIMEOUT — proceeding anyway');
        }

        initLog('MigrationGate', `persisting completion flag for account ${accountIndex}...`);
        await setMigrationsComplete(accountIndex);
        initLog('MigrationGate', 'flag persisted');

        setMigrationsCompleteDone(true);
        stage.complete();
        initLog('MigrationGate', 'stage complete — rendering children');
      } catch (error) {
        initLog('MigrationGate', `ERROR: ${error}`);
        const errorMessage = error instanceof Error ? error.message : 'Migration check failed';
        stage.error(errorMessage);
        setMigrationsCompleteDone(true);
      } finally {
        setIsChecking(false);
      }
    };

    checkMigrationsComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!migrationsComplete || isChecking) {
    return null;
  }

  return <>{children}</>;
}
