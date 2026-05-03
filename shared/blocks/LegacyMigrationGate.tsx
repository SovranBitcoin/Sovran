import React, { ReactNode } from 'react';

import { runLegacyReduxBootstrap } from '@/shared/lib/migrations/legacyReduxMigrations';
import { initLog } from '@/shared/lib/logger';
import { InitializationGate } from '@/shared/blocks/InitializationGate';

initLog('Module', 'LegacyMigrationGate loaded');

interface LegacyMigrationGateProps {
  children: ReactNode;
}

/**
 * Bootstraps current storage from a legacy Redux-based install before
 * newer AsyncStorage/Zustand key-shape migrations run.
 */
export default function LegacyMigrationGate({ children }: LegacyMigrationGateProps) {
  return (
    <InitializationGate
      tag="LegacyMigrationGate"
      stageId="legacy-redux-bootstrap"
      message="Migrating legacy app data..."
      logEvent="gate.legacy_migration"
      run={runLegacyReduxBootstrap}>
      {children}
    </InitializationGate>
  );
}
