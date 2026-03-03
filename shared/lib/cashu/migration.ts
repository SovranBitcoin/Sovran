import { Manager } from 'coco-cashu-core';
import { CheckStateEnum } from '@cashu/cashu-ts';
import { store } from '@/redux/store';
import { RootState } from '@/redux/store/reducer';
import { CashuProfile } from '@/redux/cashu/types';

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

    console.log(`Starting Redux to Coco migration for account ${this.accountIndex}...`);

    const result: MigrationResult = {
      mintsMigrated: 0,
      proofsMigrated: 0,
      countersMigrated: 0,
      errors: [],
    };

    if (!profile) {
      console.log(`No Redux profile found at index ${this.accountIndex}, skipping migration`);
      return result;
    }

    console.log('Redux profile data:', JSON.stringify(profile, null, 2));

    try {
      await this.migrateMints(profile, result);
      await this.migrateProofs(profile, result);
      await this.migrateCounters(profile, result);

      console.log('Migration completed:', result);
      return result;
    } catch (error) {
      console.error('Migration failed:', error);
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
    console.log(`Found ${mintUrls.length} unique mints to migrate:`, mintUrls);

    for (const mintUrl of mintUrls) {
      try {
        console.log(`Adding mint: ${mintUrl}`);
        await this.manager.mint.addMint(mintUrl, { trusted: true });

        try {
          const mintInfo = await this.manager.mint.getMintInfo(mintUrl);
          console.log(`Mint info loaded for ${mintUrl}:`, mintInfo);
        } catch (infoError) {
          console.warn(`Failed to load mint info for ${mintUrl}:`, infoError);
        }

        result.mintsMigrated++;
        console.log(`Migrated mint: ${mintUrl}`);
      } catch (error) {
        console.error(`Failed to migrate mint ${mintUrl}:`, error);
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
        const keysets = await this.manager.mint.getKeysets(mintUrl);
        const keysetUnitMap = new Map(
          keysets.map((k: { id: string; unit: string }) => [k.id, k.unit])
        );

        const satProofs = proofs.filter((proof) => {
          const unit = keysetUnitMap.get(proof.id);
          if (unit !== 'sat') {
            console.log(`Skipping non-sat proof (unit: ${unit || 'unknown'}) for ${mintUrl}`);
            return false;
          }
          return true;
        });

        if (satProofs.length === 0) {
          console.log(`No sat proofs to migrate for ${mintUrl}`);
          continue;
        }

        const wallet = await this.manager.walletService.getWallet(mintUrl);
        const proofStates = await wallet.checkProofsStates(satProofs);

        for (let i = 0; i < satProofs.length; i++) {
          const proof = satProofs[i];
          const state = proofStates[i];

          if (state.state === CheckStateEnum.SPENT) {
            console.log(`Skipping spent proof for ${mintUrl}`);
            continue;
          }

          if (state.state === CheckStateEnum.PENDING) {
            console.log(`Skipping pending proof for ${mintUrl}`);
            continue;
          }

          await this.manager.proofService.saveProofs(mintUrl, [
            { ...proof, mintUrl, state: 'ready' as const },
          ]);
          result.proofsMigrated++;
        }

        console.log(`Migrated proofs for ${mintUrl}`);
      } catch (error) {
        console.error(`Failed to migrate proofs for ${mintUrl}:`, error);
        result.errors.push({
          type: 'proofs_migration_failed',
          message: `Failed to migrate proofs for ${mintUrl}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }
  }

  private async migrateCounters(profile: CashuProfile, result: MigrationResult): Promise<void> {
    let totalCounters = 0;

    console.log('Profile counters:', profile.counters);
    for (const [, counters] of Object.entries(profile.counters)) {
      totalCounters += Object.keys(counters).length;
    }

    if (totalCounters === 0) {
      console.log('No counters found to migrate');
      return;
    }

    console.log(`Found ${totalCounters} counters to migrate`);

    for (const [mintUrl, counters] of Object.entries(profile.counters)) {
      for (const [keysetId, counter] of Object.entries(counters)) {
        try {
          await this.manager.counterService.overwriteCounter(mintUrl, keysetId, counter);
          result.countersMigrated++;
          console.log(`Migrated counter for ${mintUrl}:${keysetId}: ${counter}`);
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
