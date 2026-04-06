import React, { ReactNode, useEffect, useRef, useState } from 'react';

import { signalMigrationsComplete } from '@/shared/lib/cashu/profileScopedStorage';
import { runGlobalMigrations } from '@/shared/lib/migrations/globalMigrations';
import { initLog, log, Log, useLifecycleLogger } from '@/shared/lib/logger';
import { useInitializationStage } from '@/shared/providers/InitializationProvider';

interface GlobalMigrationGateProps {
  children: ReactNode;
}

/**
 * Runs all global migrations (profile-scoped key rename, etc.) once at
 * app start, before any AccountScopedProviders mount.
 * Blocks rendering of children until the runner completes.
 */
export default function GlobalMigrationGate({ children }: GlobalMigrationGateProps) {
  useLifecycleLogger('GlobalMigrationGate');
  const stage = useInitializationStage('global-migrations', {
    message: 'Running global migrations...',
    blocking: true,
    dependsOn: ['legacy-redux-bootstrap'],
  });
  const [isComplete, setIsComplete] = useState(false);
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    const run = async () => {
      try {
        stage.log('Running global migrations...');
        initLog('GlobalMigrationGate', 'starting global migrations');
        log.info('gate.global_migration.start');
        await runGlobalMigrations();
        signalMigrationsComplete();
        stage.complete();
        setIsComplete(true);
        log.info('gate.global_migration.complete');
        initLog('GlobalMigrationGate', 'global migrations complete');
      } catch (error) {
        signalMigrationsComplete();
        const msg = error instanceof Error ? error.message : 'Global migrations failed';
        log.error('gate.global_migration.failed', { error: error instanceof Error ? error : new Error(String(error)) });
        stage.error(msg);
        setIsComplete(true);
        initLog('GlobalMigrationGate', `ERROR: ${error}`);
      }
    };

    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isComplete) return null;

  return <Log name="GlobalMigrationGate">{children}</Log>;
}
