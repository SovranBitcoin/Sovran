import {
  globalRowsWrittenByMigrations,
  runGlobalMigrations,
} from '@/shared/lib/migrations/globalMigrations';
import { loadRequiredStores } from '@/shared/lib/persist/hydrationOutcome';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';

/**
 * The stores everything below the migration gate reads before it can decide
 * anything: the account list, the settings and the wallet lifecycle. They are
 * also the only global stores a migration writes; one that writes another
 * must add it here, or that store keeps what it loaded before the migration.
 */
const REQUIRED_STORES = [useProfileStore, useSettingsStore, useWalletLifecycleStore];

/**
 * What `GlobalMigrationGate` runs before it opens per-account storage. These
 * stores loaded when their modules were evaluated, so a row a migration has
 * just written (the lifecycle stamp for an upgrading wallet) is read again
 * here. Without that the gate below sees the store's defaults and asks a
 * long-standing user to restore, and its save replaces the stamp.
 */
export async function migrateThenLoad(): Promise<void> {
  await runGlobalMigrations();
  await loadRequiredStores(REQUIRED_STORES, globalRowsWrittenByMigrations());
}
