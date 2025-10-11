import { Manager, ConsoleLogger } from 'coco-cashu-core';
import { ExpoSqliteRepositories } from 'coco-cashu-expo-sqlite';
import * as SQLite from 'expo-sqlite';
import { retrieveMnemonic } from 'helper/secureStorage';
import { mnemonicToSeedSync } from 'bip39';
import { NPCPlugin } from 'coco-cashu-plugin-npc';
import { NsecSigner } from 'helper/third-party/cashu-address-sdk-rn/signer';
import * as nip06 from 'nostr-tools/nip06';
import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

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
      console.log('Manager already initialized, returning existing instance');
      return this.instance;
    }

    if (this.isInitializing) {
      console.log('Manager initialization in progress, waiting...');
      // Wait for ongoing initialization with timeout
      let attempts = 0;
      while (this.isInitializing && attempts < 50) {
        // 5 second timeout
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }
      if (this.instance) {
        return this.instance;
      }
      if (attempts >= 50) {
        throw new Error('Manager initialization timeout');
      }
    }

    console.log('Starting Manager initialization...');
    this.isInitializing = true;

    // Reset any existing instance to ensure clean start
    this.instance = null;

    try {
      // Initialize SQLite database
      const db = SQLite.openDatabaseSync('coco.db');
      const repositories = new ExpoSqliteRepositories({ database: db });
      await repositories.init();

      // Seed management - reuse existing secure storage
      const seedGetter = async (): Promise<Uint8Array> => {
        const mnemonic = await retrieveMnemonic();
        if (!mnemonic) {
          throw new Error('No mnemonic found in secure storage');
        }

        // Derive cashu mnemonic using the same logic as useCashuMnemonic hook
        const root = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(mnemonic));
        const DERIVATION_PATH = `m/44'/129372'`;
        const path = `${DERIVATION_PATH}/0'/0'/0/0`; // Account index 0
        const seed = root.derive(path);
        const derivedCashuMnemonic = bip39.entropyToMnemonic(seed.privateKey as Buffer, wordlist);

        return mnemonicToSeedSync(derivedCashuMnemonic);
      };

      // Prepare plugins array
      const plugins: any[] = [];

      // Add NPC plugin if current profile is available
      const nsecSigner = await this.getCurrentProfileSigner();
      if (nsecSigner) {
        console.log('NsecSigner created:', typeof nsecSigner, nsecSigner);

        // Create a signer function that the NPCPlugin expects
        const signerFunction = async (eventTemplate: any) => {
          console.log(
            'NPCPlugin signer function called with:',
            typeof eventTemplate,
            eventTemplate
          );
          return await nsecSigner.signEvent(eventTemplate);
        };

        console.log('Creating NPCPlugin with signer function:', typeof signerFunction);

        const npcPlugin = new NPCPlugin(
          'https://npubx.cash', // NPC server base URL
          signerFunction,
          {
            syncIntervalMs: 30000, // Sync every 30 seconds
            useWebsocket: true, // Enable real-time updates
            logger: new ConsoleLogger('NPCPlugin', { level: 'debug' }),
          }
        );
        plugins.push(npcPlugin);
        console.log('NPC plugin prepared for registration');
      } else {
        console.warn('NPC plugin not prepared - no current profile signer available');
      }

      // Create manager with repositories, seed, and plugins
      console.log('Creating Manager with plugins:', plugins.length, plugins);
      this.instance = new Manager(
        repositories,
        seedGetter,
        new ConsoleLogger('sovran', { level: 'info' }),
        undefined,
        plugins
      );
      console.log('Manager created successfully');

      // Trigger initial sync for NPC plugin if available
      if (nsecSigner && plugins.length > 0) {
        try {
          const npcPlugin = plugins[0] as NPCPlugin;
          await npcPlugin.sync();
          console.log('Initial NPC sync completed');
        } catch (error) {
          console.error('Initial NPC sync failed:', error);
        }
      }

      // Enable watchers and processors for real-time updates
      // Add longer delays between watcher initializations to prevent transaction conflicts
      try {
        await this.instance.enableMintQuoteWatcher({
          watchExistingPendingOnStart: true,
        });

        console.log('Mint quote watcher enabled');
        await new Promise((resolve) => setTimeout(resolve, 500)); // Longer delay
      } catch (error) {
        console.warn('Failed to enable mint quote watcher:', error);
      }

      try {
        await this.instance.enableMintQuoteProcessor({
          processIntervalMs: 5000, // Check every 5 seconds
          maxRetries: 3,
          baseRetryDelayMs: 1000,
          initialEnqueueDelayMs: 2000,
        });
        console.log('Mint quote processor enabled');
        await new Promise((resolve) => setTimeout(resolve, 500)); // Longer delay
      } catch (error) {
        console.warn('Failed to enable mint quote processor:', error);
      }

      // Enable ProofStateWatcher with proper error handling and retry logic
      try {
        // Add a longer delay before enabling proof state watcher to ensure
        // all previous database operations are complete
        await new Promise((resolve) => setTimeout(resolve, 1000));

        await this.instance.enableProofStateWatcher();
        console.log('Proof state watcher enabled');
      } catch (error) {
        console.warn('Failed to enable proof state watcher:', error);
        // Try again after a longer delay
        try {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          await this.instance.enableProofStateWatcher();
          console.log('Proof state watcher enabled on retry');
        } catch (retryError) {
          console.error('Failed to enable proof state watcher after retry:', retryError);
        }
      }
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
   * Cleanup method to properly shutdown watchers and prevent transaction conflicts
   */
  static async cleanup(): Promise<void> {
    if (!this.instance) {
      return;
    }

    try {
      console.log('Cleaning up Coco Manager...');

      // Disable watchers in reverse order to prevent conflicts
      try {
        await this.instance.disableProofStateWatcher();
        console.log('Proof state watcher disabled');
      } catch (error) {
        console.warn('Failed to disable proof state watcher:', error);
      }

      try {
        await this.instance.disableMintQuoteProcessor();
        console.log('Mint quote processor disabled');
      } catch (error) {
        console.warn('Failed to disable mint quote processor:', error);
      }

      try {
        await this.instance.disableMintQuoteWatcher();
        console.log('Mint quote watcher disabled');
      } catch (error) {
        console.warn('Failed to disable mint quote watcher:', error);
      }

      // Clear the instance
      this.instance = null;
      console.log('Coco Manager cleanup completed');
    } catch (error) {
      console.error('Failed to cleanup Coco Manager:', error);
    }
  }

  /**
   * Get the current profile's signer for NPC plugin
   * This creates a signer from the current profile's nsec
   */
  private static async getCurrentProfileSigner(): Promise<NsecSigner | null> {
    try {
      // Get mnemonic from secure storage
      const mnemonic = await retrieveMnemonic();

      if (!mnemonic) {
        console.warn('No mnemonic found for NPC plugin');
        return null;
      }

      // Derive Nostr keys using NIP-06 (account index 0)
      const { privateKey: sk } = nip06.accountFromSeedWords(mnemonic, undefined, 0);

      return new NsecSigner(sk);
    } catch (error) {
      console.error('Failed to create signer for NPC plugin:', error);
      return null;
    }
  }

  /**
   * Enable ProofStateWatcher separately to avoid transaction conflicts
   */
  static async enableProofStateWatcher(): Promise<void> {
    if (!this.instance) {
      throw new Error('Manager not initialized. Call initialize() first.');
    }

    try {
      await this.instance.enableProofStateWatcher();
      console.log('Proof state watcher enabled separately');
    } catch (error) {
      console.warn('Failed to enable proof state watcher:', error);
      throw error;
    }
  }

  /**
   * Safely disable all watchers before resetting
   */
  static async disableWatchers(): Promise<void> {
    if (this.instance) {
      try {
        await this.instance.disableProofStateWatcher();
        console.log('Proof state watcher disabled');
      } catch (error) {
        console.warn('Failed to disable proof state watcher:', error);
      }

      try {
        await this.instance.disableMintQuoteWatcher();
        console.log('Mint quote watcher disabled');
      } catch (error) {
        console.warn('Failed to disable mint quote watcher:', error);
      }

      try {
        await this.instance.disableMintQuoteProcessor();
        console.log('Mint quote processor disabled');
      } catch (error) {
        console.warn('Failed to disable mint quote processor:', error);
      }
    }
  }

  /**
   * Reset the manager (useful for testing or logout)
   */
  static async reset(): Promise<void> {
    await this.disableWatchers();
    this.instance = null;
    this.isInitializing = false;
  }
}
