import { Manager } from '@cashu/coco-core';
import { CheckStateEnum } from '@cashu/cashu-ts';
import { store } from '@/redux/store/store.deprecated';
import { RootState } from '@/redux/store/reducer.deprecated';
import { CashuProfile } from '@/redux/cashu/types.deprecated';
import { cashuLog } from '../logger';

/**
 * Data migration utility to move from Redux-based Cashu state to Coco repositories.
 * This handles the migration of existing user data safely.
 *
 * Each instance is scoped to a single account index so that the correct Redux
 * profile entry is migrated into the corresponding per-profile Coco database.
 */
export class DataMigration {
  constructor(
    private manager: Manager,
    private accountIndex: number
  ) {}

  /**
   * Get the Redux profile for the current account index.
   * Returns undefined if no profile exists at this index.
   */
  private getReduxProfile(): CashuProfile | undefined {
    const state = store.getState() as unknown as RootState;
    return state.cashu.profiles[this.accountIndex];
  }

  /**
   * Migrate Redux Cashu data for this account to Coco repositories.
   * Only migrates data from the Redux profile matching this.accountIndex.
   */
  async migrateFromRedux(): Promise<MigrationResult> {
    const profile = this.getReduxProfile();

    cashuLog.info('cashu.migration.start', { accountIndex: this.accountIndex });
    const migrationStart = performance.now();

    const result: MigrationResult = {
      mintsMigrated: 0,
      proofsMigrated: 0,
      countersMigrated: 0,
      errors: [],
    };

    if (!profile) {
      cashuLog.info('cashu.migration.no_profile', { accountIndex: this.accountIndex });
      return result;
    }

    cashuLog.debug('cashu.migration.profile_data', { profile });

    try {
      await this.migrateMints(profile, result);
      await this.migrateProofs(profile, result);
      await this.migrateCounters(profile, result);

      cashuLog.info('cashu.migration.completed', {
        result,
        duration_ms: Math.round((performance.now() - migrationStart) * 100) / 100,
      });
      return result;
    } catch (error) {
      cashuLog.error('cashu.migration.failed', { error });
      result.errors.push({
        type: 'migration_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      return result;
    }
  }

  private async migrateMints(profile: CashuProfile, result: MigrationResult): Promise<void> {
    const uniqueMints = new Set<string>();

    for (const mintUrl of profile.mints) {
      uniqueMints.add(mintUrl);
    }
    for (const mintUrl of Object.keys(profile.proofs)) {
      uniqueMints.add(mintUrl);
    }

    const mintUrls = Array.from(uniqueMints);
    cashuLog.info('cashu.migration.mints_found', { count: mintUrls.length, mintUrls });

    for (const mintUrl of mintUrls) {
      try {
        cashuLog.debug('cashu.migration.adding_mint', { mintUrl });
        await this.manager.mint.addMint(mintUrl, { trusted: true });

        try {
          const mintInfo = await this.manager.mint.getMintInfo(mintUrl);
          cashuLog.debug('cashu.migration.mint_info_loaded', { mintUrl });
        } catch (infoError) {
          cashuLog.warn('cashu.migration.mint_info_failed', { mintUrl, error: infoError });
        }

        result.mintsMigrated++;
        cashuLog.info('cashu.migration.mint_migrated', { mintUrl });
      } catch (error) {
        cashuLog.error('cashu.migration.mint_failed', { mintUrl, error });
        result.errors.push({
          type: 'mint_migration_failed',
          message: `Failed to migrate mint ${mintUrl}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }
  }

  private async migrateProofs(profile: CashuProfile, result: MigrationResult): Promise<void> {
    for (const [mintUrl, proofs] of Object.entries(profile.proofs)) {
      if (!Array.isArray(proofs) || proofs.length === 0) continue;

      try {
        const { keysets } = await this.manager.mint.addMint(mintUrl, { trusted: true });
        const keysetUnitMap = new Map(
          keysets.map((k: { id: string; unit: string }) => [k.id, k.unit])
        );

        const satProofs = proofs.filter((proof) => {
          const unit = keysetUnitMap.get(proof.id);
          if (unit !== 'sat') {
            cashuLog.debug('cashu.migration.skip_non_sat', { unit, mintUrl });
            return false;
          }
          return true;
        });

        if (satProofs.length === 0) {
          cashuLog.debug('cashu.migration.no_proofs', { mintUrl });
          continue;
        }

        const wallet = await this.manager.walletService.getWallet(mintUrl);
        const proofStates = await wallet.checkProofsStates(satProofs);

        for (let i = 0; i < satProofs.length; i++) {
          const proof = satProofs[i];
          const state = proofStates[i];

          if (state.state === CheckStateEnum.SPENT) {
            cashuLog.debug('cashu.migration.skip_spent', { mintUrl });
            continue;
          }

          if (state.state === CheckStateEnum.PENDING) {
            cashuLog.debug('cashu.migration.skip_pending', { mintUrl });
            continue;
          }

          await this.manager.proofService.saveProofs(mintUrl, [
            { ...proof, mintUrl, state: 'ready' as const },
          ]);
          result.proofsMigrated++;
        }

        cashuLog.info('cashu.migration.proofs_migrated', { mintUrl });
      } catch (error) {
        cashuLog.error('cashu.migration.proofs_failed', { mintUrl, error });
        result.errors.push({
          type: 'proofs_migration_failed',
          message: `Failed to migrate proofs for ${mintUrl}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }
  }

  private async migrateCounters(profile: CashuProfile, result: MigrationResult): Promise<void> {
    let totalCounters = 0;

    cashuLog.debug('cashu.migration.counters', { counters: profile.counters });
    for (const [, counters] of Object.entries(profile.counters)) {
      totalCounters += Object.keys(counters).length;
    }

    if (totalCounters === 0) {
      cashuLog.debug('cashu.migration.no_counters');
      return;
    }

    cashuLog.info('cashu.migration.counters_found', { count: totalCounters });

    for (const [mintUrl, counters] of Object.entries(profile.counters)) {
      for (const [keysetId, counter] of Object.entries(counters)) {
        try {
          await this.manager.counterService.overwriteCounter(mintUrl, keysetId, counter);
          result.countersMigrated++;
          cashuLog.debug('cashu.migration.counter_migrated', { mintUrl, keysetId, counter });
        } catch (error) {
          result.errors.push({
            type: 'counter_migration_failed',
            message: `Failed to migrate counter for ${mintUrl}:${keysetId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          });
        }
      }
    }
  }

  async isMigrationNeeded(): Promise<boolean> {
    const profile = this.getReduxProfile();

    if (!profile) {
      return false;
    }

    const hasData =
      profile.mints.length > 0 ||
      Object.keys(profile.proofs).length > 0 ||
      Object.keys(profile.counters).length > 0;

    if (!hasData) {
      return false;
    }

    try {
      const mints = await this.manager.mint.getAllMints();
      return mints.length === 0;
    } catch {
      return true;
    }
  }
}

interface MigrationResult {
  mintsMigrated: number;
  proofsMigrated: number;
  countersMigrated: number;
  errors: MigrationError[];
}

interface MigrationError {
  type: string;
  message: string;
}
