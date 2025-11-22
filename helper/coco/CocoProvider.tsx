import React, { createContext, useContext, useEffect, useState, ReactNode, useRef } from 'react';
import { CocoCashuProvider } from 'coco-cashu-react';
import { Manager } from 'coco-cashu-core';
import { CocoManager } from './manager';
import { DataMigration } from './migration';
import { useInitializationStage } from '@/providers/InitializationProvider';
interface CocoContextValue {
  manager: Manager | null;
  isReady: boolean;
  isMigrating: boolean;
  migrationError: Error | null;
}

const CocoContext = createContext<CocoContextValue>({
  manager: null,
  isReady: false,
  isMigrating: false,
  migrationError: null,
});

export const useCocoContext = () => {
  const context = useContext(CocoContext);
  if (!context) {
    throw new Error('useCocoContext must be used within a CocoProvider');
  }
  return context;
};

interface CocoProviderProps {
  children: ReactNode;
}

/**
 * Initialize default mints for new users
 * This adds the Sovran mint and Minibits mint so users have mints available immediately
 */
async function initializeDefaultMints(manager: Manager): Promise<void> {
  try {
    console.log('Initializing default mints...');

    const defaultMints = ['https://mint.sovran.money', 'https://mint.minibits.cash/Bitcoin'];

    // Add each default mint (only if not already exists)
    for (const mintUrl of defaultMints) {
      try {
        // Check if mint already exists
        const isKnown = await manager.mint.isTrustedMint(mintUrl);
        if (isKnown) {
          console.log(`ℹ️ Default mint already exists: ${mintUrl}`);
          continue;
        }

        await manager.mint.addMint(mintUrl);
        console.log(`✅ Added default mint: ${mintUrl}`);
      } catch (error) {
        console.warn(`⚠️ Failed to add default mint ${mintUrl}:`, error);
        // Continue with other mints even if one fails
      }
    }

    console.log('Default mints initialization completed');
  } catch (error) {
    console.error('Failed to initialize default mints:', error);
    // Don't throw - this shouldn't prevent the app from starting
  }
}

/**
 * CocoProvider handles the initialization of the Coco Manager and data migration
 * This should wrap your entire app and be placed above other providers
 */
export function CocoProvider({ children }: CocoProviderProps) {
  const stage = useInitializationStage('coco', {
    message: 'Initializing Coco...',
    dependsOn: ['nostr'],
  });
  const [manager, setManager] = useState<Manager | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationError, setMigrationError] = useState<Error | null>(null);
  const hasStarted = useRef(false);

  useEffect(() => {
    if (!stage.canStart) return; // Wait for nostr to complete
    if (hasStarted.current) return; // Only run once
    hasStarted.current = true;

    const initializeCoco = async () => {
      try {
        stage.log('Initializing Coco...');
        console.log('Initializing Coco Provider...');

        // Initialize the manager (includes enabling proof state watcher)
        const mgr = await CocoManager.initialize();
        setManager(mgr);

        // Check if migration is needed
        stage.log('Checking for data migration...');
        const migration = new DataMigration(mgr);
        const needsMigration = await migration.isMigrationNeeded();

        if (needsMigration) {
          stage.log('Migrating data...');
          console.log('Migration needed, starting data migration...');
          setIsMigrating(true);

          try {
            const result = await migration.migrateFromRedux();

            if (result.errors.length > 0) {
              console.warn('Migration completed with errors:', result.errors);
            } else {
              console.log('Migration completed successfully:', result);
            }
          } catch (error) {
            console.error('Migration failed:', error);
            setMigrationError(error instanceof Error ? error : new Error('Migration failed'));
          } finally {
            setIsMigrating(false);
          }
        } else {
          console.log('No migration needed');
        }

        // Initialize default mints for new users
        stage.log('Initializing default mints...');
        await initializeDefaultMints(mgr);

        setIsReady(true);
        stage.complete();
      } catch (error) {
        console.error('Failed to initialize Coco Provider:', error);
        const errorMessage = error instanceof Error ? error.message : 'Initialization failed';
        setMigrationError(error instanceof Error ? error : new Error('Initialization failed'));
        stage.error(errorMessage);
      }
    };

    initializeCoco();

    // Cleanup function
    return () => {
      console.log('CocoProvider unmounting, cleaning up...');
      // Cleanup the manager to prevent transaction conflicts
      CocoManager.cleanup().catch((error) => {
        console.error('Failed to cleanup Coco Manager on unmount:', error);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.canStart]);

  const contextValue: CocoContextValue = {
    manager,
    isReady,
    isMigrating,
    migrationError,
  };

  // Loading UI is now handled by InitializationScreen
  // Only render children when ready
  if (!isReady || !manager) {
    return <CocoContext.Provider value={contextValue}>{null}</CocoContext.Provider>;
  }

  // Wrap with CocoCashuProvider once manager is ready
  return (
    <CocoContext.Provider value={contextValue}>
      <CocoCashuProvider manager={manager}>{children}</CocoCashuProvider>
    </CocoContext.Provider>
  );
}
