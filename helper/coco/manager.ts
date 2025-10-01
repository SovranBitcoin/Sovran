import { Manager } from 'coco-cashu-core';
import { ExpoSqliteRepositories } from 'coco-cashu-expo-sqlite';
import { ConsoleLogger } from 'coco-cashu-core';
import * as SQLite from 'expo-sqlite';
import { retrieveMnemonic } from 'helper/secureStorage';
import { mnemonicToSeedSync } from 'bip39';

/**
 * Coco Manager singleton for managing Cashu operations
 * This replaces the complex Redux-based cashuClient.ts approach
 */
export class CocoManager {
  private static instance: Manager | null = null;
  private static isInitializing = false;

  /**
   * Initialize the Coco Manager with database and seed management
   * This should be called once at app startup
   */
  static async initialize(): Promise<Manager> {
    if (this.instance) {
      return this.instance;
    }

    if (this.isInitializing) {
      // Wait for ongoing initialization
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (this.instance) {
        return this.instance;
      }
    }

    this.isInitializing = true;

    try {
      console.log('Initializing Coco Manager...');

      // Initialize SQLite database
      const db = SQLite.openDatabaseSync('coco.db');
      const repositories = new ExpoSqliteRepositories({ database: db });
      await repositories.init();
      console.log('Database initialized');

      // Seed management - reuse existing secure storage
      const seedGetter = async (): Promise<Uint8Array> => {
        const mnemonic = await retrieveMnemonic();
        if (!mnemonic) {
          throw new Error('No mnemonic found in secure storage');
        }
        return mnemonicToSeedSync(mnemonic);
      };

      // Create manager with repositories and seed
      this.instance = new Manager(
        repositories,
        seedGetter,
        new ConsoleLogger('sovran', { level: 'info' })
      );

      // Enable watchers for real-time updates
      await this.instance.enableMintQuoteWatcher();
      await this.instance.enableProofStateWatcher();
      console.log('Coco Manager initialized successfully');

      return this.instance;
    } catch (error) {
      console.error('Failed to initialize Coco Manager:', error);
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Get the initialized Manager instance
   * Throws if not initialized
   */
  static getInstance(): Manager {
    if (!this.instance) {
      throw new Error('Manager not initialized. Call initialize() first.');
    }
    return this.instance;
  }

  /**
   * Check if Manager is initialized
   */
  static isInitialized(): boolean {
    return this.instance !== null;
  }

  /**
   * Reset the manager (useful for testing or logout)
   */
  static reset(): void {
    this.instance = null;
    this.isInitializing = false;
  }
}
