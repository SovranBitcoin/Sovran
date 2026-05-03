import React, { ReactNode } from 'react';

import { store } from '@/redux/store/store.deprecated';
import { isMigrationsComplete, setMigrationsComplete } from '@/shared/lib/nostr/secureStorage';
import { initLog, log } from '@/shared/lib/logger';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { InitializationGate } from '@/shared/blocks/InitializationGate';

initLog('Module', 'MigrationGate loaded');

interface MigrationGateProps {
  children: ReactNode;
}

async function awaitReduxRehydration(): Promise<void> {
  if (store.getState()._persist?.rehydrated) return;
  await new Promise<void>((resolve) => {
    const unsubscribe = store.subscribe(() => {
      if (store.getState()._persist?.rehydrated) {
        unsubscribe();
        resolve();
      }
    });
  });
}

async function runMigrations(): Promise<void> {
  const accountIndex = useProfileStore.getState().activeAccountIndex;
  log.info('gate.migration.check_start', { accountIndex });

  if (await isMigrationsComplete(accountIndex)) {
    log.info('gate.migration.fast_path', { accountIndex });
    return;
  }

  await awaitReduxRehydration();
  await setMigrationsComplete(accountIndex);
  log.info('gate.migration.complete', { accountIndex });
}

/**
 * Ensures legacy Redux migrations complete before rendering children.
 *
 * On first launch (or after a SecureStore wipe) this awaits Redux rehydration
 * and persists a per-account completion flag. On subsequent launches the flag
 * short-circuits the wait. Global profile-scoped key migrations are handled
 * separately by GlobalMigrationGate.
 */
export default function MigrationGate({ children }: MigrationGateProps) {
  return (
    <InitializationGate
      tag="MigrationGate"
      stageId="migrations"
      message="Running migrations..."
      dependsOn={['global-migrations']}
      logEvent="gate.migration"
      run={runMigrations}>
      {children}
    </InitializationGate>
  );
}
