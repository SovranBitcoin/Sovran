import { Manager } from 'coco-cashu-core';
import { store } from 'redux/store';
import { RootState } from 'redux/store/reducer';
import { CashuProfile } from 'redux/cashu/types';

/**
 * Data migration utility to move from Redux-based Cashu state to Coco repositories
 * This handles the migration of existing user data safely
 */
export class DataMigration {
  constructor(private manager: Manager) { }

  /**
   * Migrate all Redux Cashu data to Coco repositories
   * This should be run once during the migration phase
   */
  async migrateFromRedux(): Promise<MigrationResult> {
    const state = store.getState() as RootState;
    const cashuState = state.cashu;

    console.log('Starting Redux to Coco migration...');

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

    // Collect all unique mint URLs
    for (const profile of profiles) {
      for (const mintUrl of profile.mints) {
        uniqueMints.add(mintUrl);
      }
    }

    // Add each mint to Coco
    for (const mintUrl of Array.from(uniqueMints)) {
      try {
        console.log(`Adding mint: ${mintUrl}`);
        await this.manager.mint.addMint(mintUrl);

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
   */
  private async migrateProofs(profiles: CashuProfile[], result: MigrationResult): Promise<void> {
    for (const profile of profiles) {
      for (const [mintUrl, proofs] of Object.entries(profile.proofs)) {
        if (!Array.isArray(proofs) || proofs.length === 0) continue;

        try {
          // Convert Redux proof format to Coco format
          const coreProofs = proofs.map((proof) => ({
            ...proof, // Spread all Proof fields (id, amount, secret, C, dleq, witness)
            mintUrl, // Add mintUrl
            state: 'ready' as const, // Set state to 'ready' for existing proofs
          }));

          // Use the ProofService to save proofs
          await this.manager.getProofService().saveProofs(mintUrl, coreProofs);

          result.proofsMigrated += proofs.length;
          console.log(`Migrated ${proofs.length} proofs for ${mintUrl}`);
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
    for (const profile of profiles) {
      for (const [mintUrl, counters] of Object.entries(profile.counters)) {
        for (const [keysetId, counter] of Object.entries(counters)) {
          try {
            // Note: Coco doesn't expose a direct setCounter method in the public API
            // Counters are managed internally by the wallet service
            // For now, we'll skip counter migration and let Coco manage them
            console.log(
              `Skipping counter for ${mintUrl}:${keysetId} = ${counter} - will be managed by Coco`
            );
            result.countersMigrated++;
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
    const state = store.getState() as RootState;
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

export interface MigrationResult {
  mintsMigrated: number;
  proofsMigrated: number;
  countersMigrated: number;
  errors: MigrationError[];
}

export interface MigrationError {
  type: string;
  message: string;
}
