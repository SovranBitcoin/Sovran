import { Manager, ConsoleLogger } from 'coco-cashu-core';
import { ExpoSqliteRepositories } from 'coco-cashu-expo-sqlite';
import * as SQLite from 'expo-sqlite';
import { retrieveMnemonic } from 'helper/secureStorage';
import { mnemonicToSeedSync } from 'bip39';
import { NPCPlugin } from 'coco-cashu-plugin-npc';
import { NsecSigner } from 'helper/third-party/cashu-address-sdk-rn/signer';
import { nip19 } from 'nostr-tools';
import { store } from 'helper/redux/store';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr/selectors';

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
      // Wait for ongoing initialization
      while (this.isInitializing) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (this.instance) {
        return this.instance;
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
        return mnemonicToSeedSync(mnemonic);
      };

      // Prepare plugins array
      const plugins: any[] = [];

      // Add NPC plugin if current profile is available
      const nsecSigner = this.getCurrentProfileSigner();
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
      await this.instance.enableMintQuoteWatcher({
        watchExistingPendingOnStart: true,
      });
      await this.instance.enableMintQuoteProcessor({
        processIntervalMs: 5000, // Check every 5 seconds
        maxRetries: 3,
        baseRetryDelayMs: 1000,
        initialEnqueueDelayMs: 2000,
      });
      await this.instance.enableProofStateWatcher();
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
   * Get the current profile's signer for NPC plugin
   * This creates a signer from the current profile's nsec
   */
  private static getCurrentProfileSigner(): NsecSigner | null {
    try {
      const state = store.getState();
      const currentProfile = memoizedGetCurrentProfile(state);

      if (!currentProfile?.nsec) {
        console.warn('No current profile or nsec found for NPC plugin');
        return null;
      }

      const { data: secretKey } = nip19.decode(currentProfile.nsec);
      return new NsecSigner(secretKey as Uint8Array);
    } catch (error) {
      console.error('Failed to create signer for NPC plugin:', error);
      return null;
    }
  }

  /**
   * Reset the manager (useful for testing or logout)
   */
  static reset(): void {
    this.instance = null;
    this.isInitializing = false;
  }
}
