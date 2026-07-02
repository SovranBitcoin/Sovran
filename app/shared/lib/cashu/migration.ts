import { Manager } from '@cashu/coco-core';
import { CheckStateEnum } from '@cashu/cashu-ts';
import { getWallet, saveProofs, overwriteCounter } from './managerInternals';
import { store } from '@/redux/store/store.deprecated';
import { RootState } from '@/redux/store/reducer.deprecated';
import { CashuProfile } from '@/redux/cashu/types.deprecated';
import { cashuLog } from '../logger';

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

function profileLogFields(profile: CashuProfile): Record<string, unknown> {
  return {
    mintCount: profile.mints.length,
    proofMintCount: Object.keys(profile.proofs).length,
    counterMintCount: Object.keys(profile.counters).length,
  };
}

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

    cashuLog.debug('cashu.migration.profile_data', profileLogFields(profile));

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
    cashuLog.info('cashu.migration.mints_found', { count: mintUrls.length });

    for (const mintUrl of mintUrls) {
      try {
        cashuLog.debug('cashu.migration.adding_mint', { ...mintUrlLogFields(mintUrl) });
        await this.manager.mint.addMint(mintUrl, { trusted: true });

        try {
          const mintInfo = await this.manager.mint.getMintInfo(mintUrl);
          cashuLog.debug('cashu.migration.mint_info_loaded', {
            ...mintUrlLogFields(mintUrl),
            hasInfo: !!mintInfo,
          });
        } catch (infoError) {
          cashuLog.warn('cashu.migration.mint_info_failed', {
            ...mintUrlLogFields(mintUrl),
            error: infoError,
          });
        }

        result.mintsMigrated++;
        cashuLog.info('cashu.migration.mint_migrated', { ...mintUrlLogFields(mintUrl) });
      } catch (error) {
        cashuLog.error('cashu.migration.mint_failed', { ...mintUrlLogFields(mintUrl), error });
        result.errors.push({
          type: 'mint_migration_failed',
          message: `Failed to migrate mint: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
            cashuLog.debug('cashu.migration.skip_non_sat', {
              unit,
              ...mintUrlLogFields(mintUrl),
            });
            return false;
          }
          return true;
        });

        if (satProofs.length === 0) {
          cashuLog.debug('cashu.migration.no_proofs', { ...mintUrlLogFields(mintUrl) });
          continue;
        }

        const wallet = await getWallet(this.manager, mintUrl, 'sat');
        const proofStates = await wallet.checkProofsStates(satProofs);

        for (let i = 0; i < satProofs.length; i++) {
          const proof = satProofs[i];
          const state = proofStates[i];

          if (state.state === CheckStateEnum.SPENT) {
            cashuLog.debug('cashu.migration.skip_spent', { ...mintUrlLogFields(mintUrl) });
            continue;
          }

          if (state.state === CheckStateEnum.PENDING) {
            cashuLog.debug('cashu.migration.skip_pending', { ...mintUrlLogFields(mintUrl) });
            continue;
          }

          await saveProofs(this.manager, mintUrl, [
            // Only sat proofs pass the keyset-unit filter above.
            { ...proof, mintUrl, state: 'ready' as const, unit: 'sat' },
          ]);
          result.proofsMigrated++;
        }

        cashuLog.info('cashu.migration.proofs_migrated', { ...mintUrlLogFields(mintUrl) });
      } catch (error) {
        cashuLog.error('cashu.migration.proofs_failed', { ...mintUrlLogFields(mintUrl), error });
        result.errors.push({
          type: 'proofs_migration_failed',
          message: `Failed to migrate proofs: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }
  }

  private async migrateCounters(profile: CashuProfile, result: MigrationResult): Promise<void> {
    let totalCounters = 0;

    cashuLog.debug('cashu.migration.counters', {
      counterMintCount: Object.keys(profile.counters).length,
    });
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
          await overwriteCounter(this.manager, mintUrl, keysetId, counter);
          result.countersMigrated++;
          cashuLog.debug('cashu.migration.counter_migrated', {
            ...mintUrlLogFields(mintUrl),
            keysetId,
            counter,
          });
        } catch (error) {
          result.errors.push({
            type: 'counter_migration_failed',
            message: `Failed to migrate counter for keyset ${keysetId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
