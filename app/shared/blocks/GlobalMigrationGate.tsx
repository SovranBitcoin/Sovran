import { ReactNode } from 'react';

import { signalMigrationsComplete } from '@/shared/lib/cashu/profileScopedStorage';
import { runGlobalMigrations } from '@/shared/lib/migrations/globalMigrations';
import { loadRequiredStores } from '@/shared/lib/persist/hydrationOutcome';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';
import { initLog } from '@/shared/lib/logger';
import { InitializationGate } from '@/shared/blocks/InitializationGate';
import { StartupFailedScreen } from '@/shared/blocks/StartupFailedScreen';

initLog('Module', 'GlobalMigrationGate loaded');

const REQUIRED_STORES = [useProfileStore, useSettingsStore, useWalletLifecycleStore];

async function migrateThenLoad(): Promise<void> {
  await runGlobalMigrations();
  await loadRequiredStores(REQUIRED_STORES);
}

interface GlobalMigrationGateProps {
  children: ReactNode;
}

/**
 * Runs all global migrations (profile-scoped key rename, etc.) once at
 * app start, before any AccountScopedProviders mount. Blocks rendering of
 * children until the runner completes.
 *
 * `signalMigrationsComplete()` opens the profile-scoped storage gate that
 * Zustand persist waits on. It MUST fire only on success — opening the gate
 * after a partial migration causes stores to load empty defaults and then
 * overwrite the migrated data on first write (audit-46 F-001).
 *
 * A failed run therefore stops here, on a screen with a retry. Nothing below
 * mounts and no store reads or writes until a run succeeds.
 *
 * The same goes for the three stores everything below reads before it can
 * decide anything: the account list, the settings and the wallet lifecycle.
 * If one cannot be read, starting on its defaults would show a wallet with no
 * accounts or ask a long-standing user to restore.
 */
export default function GlobalMigrationGate({ children }: GlobalMigrationGateProps) {
  return (
    <InitializationGate
      tag="GlobalMigrationGate"
      stageId="global-migrations"
      outlivesAccount
      message="Running global migrations..."
      logEvent="gate.global_migration"
      run={migrateThenLoad}
      onSuccess={signalMigrationsComplete}
      renderFailure={(retry) => <StartupFailedScreen step="storage" onRetry={retry} />}>
      {children}
    </InitializationGate>
  );
}
