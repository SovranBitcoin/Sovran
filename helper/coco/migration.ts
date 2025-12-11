import { Manager } from 'coco-cashu-core';
import { store } from 'redux/store';
import { RootState } from 'redux/store/reducer';
import { CashuProfile } from 'redux/cashu/types';
import { Alert } from 'react-native';

/**
 * Data migration utility to move from Redux-based Cashu state to Coco repositories
 * This handles the migration of existing user data safely
 */
export class DataMigration {
  constructor(private manager: Manager) {}

  /**
   * Migrate all Redux Cashu data to Coco repositories
   * This should be run once during the migration phase
   */
  async migrateFromRedux(): Promise<MigrationResult> {
    const state = store.getState() as unknown as RootState;
    const cashuState = state.cashu;

    console.log('Starting Redux to Coco migration...');
    console.log('Redux cashu state:', JSON.stringify(cashuState, null, 2));

    const result: MigrationResult = {
      mintsMigrated: 0,
      proofsMigrated: 0,
      countersMigrated: 0,
      errors: [],
    };

    try {
      // Migrate mints first
      await this.migrateMints(cashuState.profiles, result);

      // Migrate proofs
      await this.migrateProofs(cashuState.profiles, result);

      // Migrate counters
      await this.migrateCounters(cashuState.profiles, result);

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

  /**
   * Migrate mint URLs to Coco
   */
  private async migrateMints(profiles: CashuProfile[], result: MigrationResult): Promise<void> {
    const uniqueMints = new Set<string>();

    // Collect all unique mint URLs from both mints array and proofs keys
    for (const profile of profiles) {
      // Add mints from the mints array
      for (const mintUrl of profile.mints) {
        uniqueMints.add(mintUrl);
      }

      // Add mints from proofs keys (mint URLs that have proofs)
      for (const mintUrl of Object.keys(profile.proofs)) {
        uniqueMints.add(mintUrl);
      }
    }

    // Add each mint to Coco
    const mintUrls = Array.from(uniqueMints);
    console.log(`Found ${mintUrls.length} unique mints to migrate:`, mintUrls);

    for (const mintUrl of mintUrls) {
      try {
        console.log(`Adding mint: ${mintUrl}`);
        await this.manager.mint.addMint(mintUrl, { trusted: true });

        // Try to get mint info to ensure it's loaded
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

  /**
   * Migrate proofs to Coco repositories
   * Only migrates proofs with "sat" unit
   */
  private async migrateProofs(profiles: CashuProfile[], result: MigrationResult): Promise<void> {
    for (const profile of profiles) {
      for (const [mintUrl, proofs] of Object.entries(profile.proofs)) {
        if (!Array.isArray(proofs) || proofs.length === 0) continue;

        try {
          // Get keysets from mint
          const keysets = await this.manager.mint.getKeysets(mintUrl);
          const keysetUnitMap = new Map(
            keysets.map((k: { id: string; unit: string }) => [k.id, k.unit])
          );

          // Filter and save only sat proofs
          for (const proof of proofs) {
            const unit = keysetUnitMap.get(proof.id);
            if (unit !== 'sat') {
              console.log(`Skipping non-sat proof (unit: ${unit || 'unknown'}) for ${mintUrl}`);
              continue;
            }

            // Save sat proof
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
  }

  /**
   * Migrate counter values to Coco
   */
  private async migrateCounters(profiles: CashuProfile[], result: MigrationResult): Promise<void> {
    let totalCounters = 0;

    // Count total counters first for logging
    for (const profile of profiles) {
      console.log('Profile counters:', profile.counters);
      for (const [, counters] of Object.entries(profile.counters)) {
        totalCounters += Object.keys(counters).length;
      }
    }

    if (totalCounters === 0) {
      console.log('No counters found to migrate');
      return;
    }

    console.log(`Found ${totalCounters} counters to migrate`);

    Alert.alert(`Migrated counter for ${totalCounters} counters`);
    for (const profile of profiles) {
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
  }

  /**
   * Check if migration is needed by comparing Redux state with Coco state
   */
  async isMigrationNeeded(): Promise<boolean> {
    const state = store.getState() as unknown as RootState;
    const cashuState = state.cashu;

    // Check if there's any data in Redux that needs migration
    const hasData = cashuState.profiles.some(
      (profile) =>
        profile.mints.length > 0 ||
        Object.keys(profile.proofs).length > 0 ||
        Object.keys(profile.counters).length > 0
    );

    if (!hasData) {
      return false;
    }

    // Check if Coco already has data
    try {
      const mints = await this.manager.mint.getAllMints();
      return mints.length === 0; // Migration needed if Coco has no mints but Redux has data
    } catch {
      return true; // If we can't check, assume migration is needed
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
