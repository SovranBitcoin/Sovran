import React, { ReactNode, useEffect, useRef, useState } from 'react';

import { runLegacyReduxBootstrap } from '@/shared/lib/migrations/legacyReduxMigrations';
import { initLog, log, Log, useLifecycleLogger } from '@/shared/lib/logger';
import { useInitializationStage } from '@/shared/providers/InitializationProvider';

interface LegacyMigrationGateProps {
  children: ReactNode;
}

/**
 * Bootstraps current storage from a legacy Redux-based install before
 * newer AsyncStorage/Zustand key-shape migrations run.
 */
export default function LegacyMigrationGate({ children }: LegacyMigrationGateProps) {
  useLifecycleLogger('LegacyMigrationGate');
  const stage = useInitializationStage('legacy-redux-bootstrap', {
    message: 'Migrating legacy app data...',
    blocking: true,
  });
  const [isComplete, setIsComplete] = useState(false);
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    const run = async () => {
      try {
        stage.log('Migrating legacy app data...');
        initLog('LegacyMigrationGate', 'starting legacy bootstrap');
        log.info('gate.legacy_migration.start');
        await runLegacyReduxBootstrap();
        stage.complete();
        setIsComplete(true);
        log.info('gate.legacy_migration.complete');
        initLog('LegacyMigrationGate', 'legacy bootstrap complete');
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Legacy migrations failed';
        log.error('gate.legacy_migration.failed', {
          error: error instanceof Error ? error : new Error(String(error)),
        });
        stage.error(msg);
        setIsComplete(true);
        initLog('LegacyMigrationGate', `ERROR: ${error}`);
      }
    };

    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isComplete) return null;

  return <Log name="LegacyMigrationGate">{children}</Log>;
}
